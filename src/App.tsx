import { useEffect, useMemo, useRef, useState } from 'react'
import type { DecodeOptions } from './utils/webglDump'
import { readCaptureFiles } from './utils/fileLoad'
import { downloadBytes } from './utils/download'
import GlbViewer from './components/GlbViewer'

const DEFAULT_SCALE = 0.000015259021896696422
const USERSCRIPT_URL =
  'https://greasyfork.org/en/scripts/567856-webgl-sniffer-dump-buffers-drawcalls-meshy-helper'

type Status = { ok: boolean; message: string }

type WorkerResult = {
  type: 'result'
  purpose: 'preview' | 'download' | 'stored'
  stats?: unknown
  glb?: Uint8Array
  filename?: string
  previewSkipped?: boolean
  reason?: string
}

type WorkerError = {
  type: 'error'
  message: string
}

type WorkerMessage = WorkerResult | WorkerError

function App() {
  const [status, setStatus] = useState<Status>({ ok: true, message: 'Waiting for files...' })
  const [summary, setSummary] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [isBuilding, setIsBuilding] = useState(false)
  const [glbPreview, setGlbPreview] = useState<Uint8Array | null>(null)
  const [glbFilename, setGlbFilename] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [hasCapture, setHasCapture] = useState(false)
  const [previewMessage, setPreviewMessage] = useState('Upload a GLB to preview it here.')
  const [previewReady, setPreviewReady] = useState(false)

  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [biasX, setBiasX] = useState(0)
  const [biasY, setBiasY] = useState(0)
  const [biasZ, setBiasZ] = useState(0)
  const [swapYZ, setSwapYZ] = useState(false)
  const [invertZ, setInvertZ] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const previewInputRef = useRef<HTMLInputElement | null>(null)
  const workerRef = useRef<Worker | null>(null)

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

  useEffect(() => {
    const worker = new Worker(new URL('./workers/gltfWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data
      if (data.type === 'result') {
        if (data.stats) {
          setSummary(JSON.stringify(data.stats, null, 2))
        }

        if (data.purpose === 'stored') {
          setStatus({ ok: true, message: 'Capture loaded. You can download a GLB when ready.' })
          setHasCapture(true)
          setIsBuilding(false)
          return
        }

        if (data.purpose === 'preview') {
          if (data.previewSkipped) {
            setStatus({ ok: true, message: 'Preview skipped due to size. You can still download GLB.' })
          }
          setHasCapture(true)
          setIsBuilding(false)
        }

        if (data.purpose === 'download') {
          if (data.glb && data.filename) {
            downloadBytes(data.glb, data.filename, 'model/gltf-binary')
            setStatus({ ok: true, message: 'Download complete. Upload the GLB to preview it.' })
          }
          setIsBuilding(false)
        }
      } else if (data.type === 'error') {
        setStatus({ ok: false, message: data.message })
        setIsBuilding(false)
      }
    }

    worker.onerror = (event) => {
      setStatus({ ok: false, message: event.message })
      setIsBuilding(false)
    }

    return () => {
      worker.terminate()
      workerRef.current = null
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    try {
      const { captureJson: json, captureBin: bin } = await readCaptureFiles(files)
      if (!json || !bin) {
        setStatus({ ok: false, message: 'Please provide both the .json and .bin files.' })
        return
      }

      if (!workerRef.current) {
        setStatus({ ok: false, message: 'Worker not ready. Please reload the page.' })
        return
      }

      setIsBuilding(true)
      setStatus({ ok: true, message: 'Processing capture files...' })
      setGlbPreview(null)
      setGlbFilename(null)
      setHasCapture(false)
      setPreviewReady(false)
      setPreviewMessage('Upload a GLB to preview it here.')

      workerRef.current.postMessage({ type: 'store', json, bin }, [bin])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ ok: false, message })
      setIsBuilding(false)
    }
  }

  function handleDownloadGlb() {
    if (!workerRef.current || !hasCapture || isBuilding) return

    if (glbPreview && glbFilename) {
      downloadBytes(glbPreview, glbFilename, 'model/gltf-binary')
      return
    }

    setIsBuilding(true)
    setStatus({ ok: true, message: 'Building GLB for download...' })
    workerRef.current.postMessage({ type: 'download', options: decodeOptions })
  }

  function handlePreviewUpload(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.glb')) {
      setStatus({ ok: false, message: 'Please select a .glb file for preview.' })
      return
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setPreviewMessage('')
    setPreviewReady(true)
    setStatus({ ok: true, message: 'Preview loaded from uploaded GLB.' })
  }

  const dropZoneClass = `drop-zone ${isDragging ? 'drop-zone--active' : ''}`

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">WebGL Dump Compiler</p>
          <h1>WebGL capture to GLB</h1>
          <p className="subtitle">
            Drop the capture files and export clean geometry for Blender, Three.js, or any glTF pipeline.
          </p>
        </div>
        <div className="hero-panel">
          <div className="hero-panel__line">Inputs</div>
          <div className="hero-panel__value">webgl_capture_*.json + webgl_capture_*.bin</div>
          <div className="hero-panel__line">Outputs</div>
          <div className="hero-panel__value">.glb</div>
        </div>
      </header>

      <article className="card mb-5">
        <div className="card__header">
          <h2>Capture Helper</h2>
          <span className="badge">Tampermonkey</span>
        </div>
        <p className="status">
          Install the WebGL sniffer userscript to capture buffers and draw calls for this compiler.
        </p>
        <div className="actions actions--download">
          <a className="link-button" href={USERSCRIPT_URL} target="_blank" rel="noreferrer">
            Get Userscript
          </a>
        </div>
        <p className="hint">You will need the Tampermonkey extension to install it.</p>
      </article>

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
        <button type="button" className="ghost-button" disabled={isBuilding}>
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

          <div className="actions actions--download">
            <button type="button" onClick={handleDownloadGlb} disabled={!hasCapture || isBuilding}>
              Download Model
            </button>
          </div>

          <p className="hint">The tool dequantizes positions to FLOAT for maximum compatibility.</p>
        </article>

        {/* <article className="card">
          <div className="card__header">
            <h2>Preview Upload</h2>
            <span className="badge">GLB</span>
          </div>
          <p className="status">Upload a GLB file to preview it without building in memory.</p>
          
          <p className="hint">This uses a file URL to avoid heavy memory usage.</p>
        </article> */}

        <article className="card card--viewer">
          <div className="card__header">
            <h2>Model Preview</h2>
            <span className="badge">{previewReady ? 'Loaded' : 'Waiting'}</span>
          </div>
          <GlbViewer glb={glbPreview} glbUrl={previewUrl} isLoading={isBuilding} emptyMessage={previewMessage} />
          <p className="hint">Use the mouse to orbit and inspect the generated model.</p>
          <div className="actions actions--download">
            <button type="button" className="ghost-button" onClick={() => previewInputRef.current?.click()}>
              Upload GLB
            </button>
            <input
              ref={previewInputRef}
              type="file"
              accept=".glb"
              hidden
              onChange={(event) => handlePreviewUpload(event.target.files)}
            />
          </div>
          <p className="status">Upload a GLB file to preview it.</p>
        </article>
      </section>
    </div>
  )
}

export default App
