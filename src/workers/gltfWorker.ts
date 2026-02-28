import { buildGltf, buildStats, pickMainDrawCall, type CaptureJson, type DecodeOptions, type SelectedDraw } from '../utils/webglDump'
import { buildGlb } from '../utils/glb'

type LoadMessage = {
  type: 'load'
  json: CaptureJson
  bin: ArrayBuffer
  options: DecodeOptions
}

type StoreMessage = {
  type: 'store'
  json: CaptureJson
  bin: ArrayBuffer
}

type RebuildMessage = {
  type: 'rebuild'
  options: DecodeOptions
}

type DownloadMessage = {
  type: 'download'
  options: DecodeOptions
}

type IncomingMessage = LoadMessage | StoreMessage | RebuildMessage | DownloadMessage

type ResultMessage = {
  type: 'result'
  purpose: 'preview' | 'download' | 'stored'
  stats?: unknown
  glb?: Uint8Array
  filename?: string
  previewSkipped?: boolean
  reason?: string
}

type ErrorMessage = {
  type: 'error'
  message: string
}

const MAX_PREVIEW_BYTES = 200 * 1024 * 1024

let captureJson: CaptureJson | null = null
let captureBin: ArrayBuffer | null = null
let selected: SelectedDraw | null = null

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const data = event.data

  if (data.type === 'load') {
    captureJson = data.json
    captureBin = data.bin
    selected = pickMainDrawCall(captureJson)

    if (!selected) {
      postError('Could not find a suitable drawElements TRIANGLES call in JSON.')
      return
    }

    buildPreviewOrSkip(data.options)
    return
  }

  if (data.type === 'store') {
    captureJson = data.json
    captureBin = data.bin
    selected = pickMainDrawCall(captureJson)

    if (!selected) {
      postError('Could not find a suitable drawElements TRIANGLES call in JSON.')
      return
    }

    const stats = buildStats(selected)
    const message: ResultMessage = { type: 'result', purpose: 'stored', stats }
    self.postMessage(message)
    return
  }

  if (data.type === 'rebuild') {
    if (!captureJson || !captureBin || !selected) {
      postError('Missing capture data in worker. Please reload the files.')
      return
    }

    buildPreviewOrSkip(data.options)
    return
  }

  if (data.type === 'download') {
    if (!captureJson || !captureBin || !selected) {
      postError('Missing capture data in worker. Please reload the files.')
      return
    }

    buildAndPost(data.options, 'download')
  }
}

function buildPreviewOrSkip(options: DecodeOptions) {
  if (!captureJson || !captureBin || !selected) return

  if (captureBin.byteLength > MAX_PREVIEW_BYTES) {
    const stats = buildStats(selected)
    const message: ResultMessage = {
      type: 'result',
      purpose: 'preview',
      stats,
      previewSkipped: true,
      reason: `Preview skipped: capture is ${(captureBin.byteLength / (1024 * 1024)).toFixed(1)} MB.`,
    }
    self.postMessage(message)
    return
  }

  buildAndPost(options, 'preview')
}

function buildAndPost(options: DecodeOptions, purpose: 'preview' | 'download') {
  if (!captureJson || !captureBin || !selected) return

  try {
    const built = buildGltf(captureBin, selected, options)
    const glb = buildGlb(built)
    const filename = built.filenames.gltf.replace(/\.gltf$/i, '.glb')
    const stats = buildStats(selected)

    const message: ResultMessage = {
      type: 'result',
      purpose,
      stats,
      glb,
      filename,
    }

    self.postMessage(message, { transfer: [glb.buffer] })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    postError(message)
  }
}

function postError(message: string) {
  const error: ErrorMessage = { type: 'error', message }
  self.postMessage(error)
}
