import type { BuiltGltf } from './webglDump'

export function buildGlb(built: BuiltGltf) {
  const gltf = cloneGltf(built.gltfJsonObj)
  if (Array.isArray((gltf as { buffers?: Array<{ uri?: string }> }).buffers)) {
    const buffers = (gltf as { buffers: Array<{ uri?: string; byteLength?: number }> }).buffers
    if (buffers[0]) {
      delete buffers[0].uri
      buffers[0].byteLength = built.binU8.byteLength
    }
  }

  const jsonText = JSON.stringify(gltf)
  const jsonBytes = new TextEncoder().encode(jsonText)
  const jsonPadded = padTo4(jsonBytes, 0x20)
  const binPadded = padTo4(built.binU8, 0x00)

  const totalLength = 12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength
  const glb = new Uint8Array(totalLength)
  const view = new DataView(glb.buffer)

  let offset = 0
  view.setUint32(offset, 0x46546c67, true)
  offset += 4
  view.setUint32(offset, 2, true)
  offset += 4
  view.setUint32(offset, totalLength, true)
  offset += 4

  view.setUint32(offset, jsonPadded.byteLength, true)
  offset += 4
  view.setUint32(offset, 0x4e4f534a, true)
  offset += 4
  glb.set(jsonPadded, offset)
  offset += jsonPadded.byteLength

  view.setUint32(offset, binPadded.byteLength, true)
  offset += 4
  view.setUint32(offset, 0x004e4942, true)
  offset += 4
  glb.set(binPadded, offset)

  return glb
}

function cloneGltf(obj: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
}

function padTo4(bytes: Uint8Array, padByte: number) {
  const pad = (4 - (bytes.byteLength % 4)) % 4
  if (!pad) return bytes
  const out = new Uint8Array(bytes.byteLength + pad)
  out.set(bytes, 0)
  out.fill(padByte, bytes.byteLength)
  return out
}
