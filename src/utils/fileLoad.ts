import type { CaptureJson } from './webglDump'

export async function readCaptureFiles(files: File[]) {
  let captureJson: CaptureJson | null = null
  let captureBin: ArrayBuffer | null = null

  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.json')) {
      captureJson = JSON.parse(await file.text()) as CaptureJson
    } else if (lower.endsWith('.bin')) {
      captureBin = await file.arrayBuffer()
    }
  }

  return { captureJson, captureBin }
}
