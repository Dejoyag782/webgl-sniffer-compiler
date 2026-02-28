import { useMemo, useRef, useState } from 'react'
import {
  buildGltf,
  buildObj,
  buildStats,
  pickMainDrawCall,
  type BuiltGltf,
  type CaptureJson,
  type DecodeOptions,
  type SelectedDraw,
} from './utils/webglDump'
import { readCaptureFiles } from './utils/fileLoad'
import { downloadBytes, downloadText } from './utils/download'
import { buildGlb } from './utils/glb'

const DEFAULT_SCALE = 0.000015259021896696422

type Status = { ok: boolean; message: string }

function App() {
  const [captureJson, setCaptureJson] = useState<CaptureJson | null>(null)
  const [captureBin, setCaptureBin] = useState<ArrayBuffer | null>(null)
  const [selected, setSelected] = useState<SelectedDraw | null>(null)
  const [status, setStatus] = useState<Status>({ ok: true, message: 'Waiting for files...' })
  const [summary, setSummary] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [builtGltf, setBuiltGltf] = useState<BuiltGltf | null>(null)

  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [biasX, setBiasX] = useState(0)
  const [biasY, setBiasY] = useState(0)
  const [biasZ, setBiasZ] = useState(0)
  const [swapYZ, setSwapYZ] = useState(false)
  const [invertZ, setInvertZ] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const ready = Boolean(captureJson && captureBin && selected)

  const decodeOptions = useMemo<DecodeOptions>(
    () => ({
      scale: Number.isFinite(scale) ? scale : DEFAULT_SCALE,
      biasX: Number.isFinite(biasX) ? biasX : 0,
      biasY: Number.isFinite(biasY) ? biasY : 0,
      biasZ: Number.isFinite(biasZ) ? biasZ : 0,
      swapYZ,
      invertZ,
    }),
    [scale, biasX, biasY, biasZ, swapYZ, invertZ],
  )

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    try {
      const { captureJson: json, captureBin: bin } = await readCaptureFiles(files)
      if (!json || !bin) {
        setStatus({ ok: false, message: 'Please provide both the .json and .bin files.' })
        return
      }

      const picked = pickMainDrawCall(json)
      if (!picked) {
        setStatus({ ok: false, message: 'Could not find a suitable drawElements TRIANGLES call in JSON.' })
        return
      }

      setCaptureJson(json)
      setCaptureBin(bin)
      setSelected(picked)
      setBuiltGltf(null)

      const stats = buildStats(picked)
      setSummary(JSON.stringify(stats, null, 2))
      setStatus({ ok: true, message: 'Loaded JSON+BIN. Main draw call selected.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ ok: false, message })
    }
  }

  function ensureReady() {
    if (!captureJson) throw new Error('Missing JSON file.')
    if (!captureBin) throw new Error('Missing BIN file.')
    if (!selected) throw new Error('No draw call selected.')
  }

  function handleBuildStats() {
    try {
      ensureReady()
      const stats = buildStats(selected as SelectedDraw)
      setSummary(JSON.stringify(stats, null, 2))
      setStatus({ ok: true, message: 'Preview stats updated.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ ok: false, message })
    }
  }

  function handleBuildGltf() {
    try {
      ensureReady()
      const built = buildGltf(captureBin as ArrayBuffer, selected as SelectedDraw, decodeOptions)
      setBuiltGltf(built)
      const stats = buildStats(selected as SelectedDraw)
      setSummary(JSON.stringify(stats, null, 2))
      setStatus({ ok: true, message: 'Built glTF in memory. Download .gltf and .bin.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ ok: false, message })
    }
  }

  function handleBuildGlb() {
    try {
      ensureReady()
      const built = buildGltf(captureBin as ArrayBuffer, selected as SelectedDraw, decodeOptions)
      setBuiltGltf(built)
      const glb = buildGlb(built)
      const filename = built.filenames.gltf.replace(/\.gltf$/i, '.glb')
      downloadBytes(glb, filename, 'model/gltf-binary')
      const stats = buildStats(selected as SelectedDraw)
      setSummary(JSON.stringify(stats, null, 2))
      setStatus({ ok: true, message: 'Built and downloaded GLB.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ ok: false, message })
    }
  }

  function handleDownloadGltf() {
    if (!builtGltf) return
    downloadText(JSON.stringify(builtGltf.gltfJsonObj, null, 2), builtGltf.filenames.gltf, 'model/gltf+json')
  }

  function handleDownloadBin() {
    if (!builtGltf) return
    downloadBytes(builtGltf.binU8, builtGltf.filenames.bin, 'application/octet-stream')
  }

  function handleDownloadGlb() {
    if (!builtGltf) return
    const glb = buildGlb(builtGltf)
    const filename = builtGltf.filenames.gltf.replace(/\.gltf$/i, '.glb')
    downloadBytes(glb, filename, 'model/gltf-binary')
  }

  async function handleDownloadObj() {
    try {
      ensureReady()
      const objText = buildObj(captureBin as ArrayBuffer, selected as SelectedDraw, decodeOptions)
      downloadText(objText, 'mesh.obj', 'text/plain')
      setStatus({ ok: true, message: 'OBJ export ready.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ ok: false, message })
    }
  }

  const dropZoneClass = `drop-zone ${isDragging ? 'drop-zone--active' : ''}`

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">WebGL Dump Compiler</p>
          <h1>WebGL capture to glTF and OBJ</h1>
          <p className="subtitle">
            Drop the capture files and export clean geometry for Blender, Three.js, or any glTF pipeline.
          </p>
        </div>
        <div className="hero-panel">
          <div className="hero-panel__line">Inputs</div>
          <div className="hero-panel__value">webgl_capture_*.json + webgl_capture_*.bin</div>
          {/* <div className="hero-panel__line">Outputs</div>
          <div className="hero-panel__value">.gltf + .bin, or .obj</div> */}
        </div>
      </header>

      <section
        className={dropZoneClass}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          handleFiles(event.dataTransfer.files)
        }}
      >
        <div>
          <strong>Drop both files here</strong>
          <p>webgl_capture_*.json and webgl_capture_*.bin</p>
        </div>
        <button type="button" className="ghost-button">
          Browse files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />
      </section>

      <section className="grid">
        <article className="card">
          <div className="card__header">
            <h2>Status</h2>
            <span className={status.ok ? 'badge badge--ok' : 'badge badge--bad'}>{status.ok ? 'OK' : 'Error'}</span>
          </div>
          <p className={status.ok ? 'status status--ok' : 'status status--bad'}>{status.message}</p>
          <pre className="summary">{summary || 'Load files to see summary data.'}</pre>
        </article>

        <article className="card">
          <div className="card__header">
            <h2>Decode Settings</h2>
            <span className="badge">Positions</span>
          </div>
          <div className="field">
            <label htmlFor="posScale">Position scale (multiply)</label>
            <input
              id="posScale"
              type="number"
              step="any"
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
            />
            <span className="hint">Default = 1/65535 (good starting point for UNSIGNED_SHORT)</span>
          </div>
          <div className="field">
            <label>Position bias (add)</label>
            <div className="field__row">
              <input
                type="number"
                step="any"
                value={biasX}
                onChange={(event) => setBiasX(Number(event.target.value))}
                aria-label="Bias X"
              />
              <input
                type="number"
                step="any"
                value={biasY}
                onChange={(event) => setBiasY(Number(event.target.value))}
                aria-label="Bias Y"
              />
              <input
                type="number"
                step="any"
                value={biasZ}
                onChange={(event) => setBiasZ(Number(event.target.value))}
                aria-label="Bias Z"
              />
            </div>
          </div>
          <div className="field">
            <label>Axes fixes (sometimes needed)</label>
            <div className="field__row field__row--checks">
              <label className="check">
                <input type="checkbox" checked={swapYZ} onChange={(event) => setSwapYZ(event.target.checked)} />
                Swap Y/Z
              </label>
              <label className="check">
                <input type="checkbox" checked={invertZ} onChange={(event) => setInvertZ(event.target.checked)} />
                Invert Z
              </label>
            </div>
          </div>

          <div className="actions">
            <button type="button" onClick={handleBuildStats} disabled={!ready}>
              Rebuild preview stats
            </button>
            {/* <button type="button" onClick={handleBuildGltf} disabled={!ready}>
              Build glTF
            </button> */}
            <button type="button" onClick={handleBuildGlb} disabled={!ready}>
              Build + Download GLB
            </button>
          </div>

          {/* <div className="actions actions--download">
            <button type="button" onClick={handleDownloadGltf} disabled={!builtGltf}>
              Download .gltf
            </button>
            <button type="button" onClick={handleDownloadGlb} disabled={!builtGltf}>
              Download .glb
            </button>
            <button type="button" onClick={handleDownloadBin} disabled={!builtGltf}>
              Download .bin
            </button>
            <button type="button" onClick={handleDownloadObj} disabled={!ready}>
              Download OBJ
            </button>
          </div> */}

          <p className="hint">The tool dequantizes positions to FLOAT for maximum compatibility.</p>
        </article>
      </section>
    </div>
  )
}

export default App
