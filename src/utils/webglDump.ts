export type CaptureJson = {
  buffers?: BufferEntry[]
  contexts?: ContextEntry[]
}

export type BufferEntry = {
  id: number
  binOffset: number
  byteLength: number
}

export type ContextEntry = {
  draws?: DrawCall[]
}

export type DrawCall = {
  kind: string
  mode: number
  count: number
  indexType?: string
  indexTypeEnum: number
  indexOffset?: number
  elementArrayBufferId?: number
  attribs?: Attribute[]
}

export type Attribute = {
  index: number
  size: number
  typeEnum: number
  normalized?: boolean
  stride?: number
  offset?: number
  bufferId: number
}

export type SelectedDraw = {
  draw: DrawCall
  buffersById: Map<number, BufferEntry>
}

export type DecodeOptions = {
  scale: number
  biasX: number
  biasY: number
  biasZ: number
  swapYZ: boolean
  invertZ: boolean
}

export type BuiltGltf = {
  gltfJsonObj: Record<string, unknown>
  binU8: Uint8Array
  filenames: { gltf: string; bin: string }
}

export function pickMainDrawCall(json: CaptureJson): SelectedDraw | null {
  const buffersById = new Map<number, BufferEntry>()
  for (const buffer of json.buffers || []) buffersById.set(buffer.id, buffer)

  let best: DrawCall | null = null
  for (const ctx of json.contexts || []) {
    for (const draw of ctx.draws || []) {
      if (draw.kind !== 'drawElements') continue
      if (draw.mode !== 4) continue
      if (typeof draw.count !== 'number') continue
      if (!Array.isArray(draw.attribs) || draw.attribs.length === 0) continue
      if (!draw.elementArrayBufferId) continue

      if (!best || draw.count > best.count) best = draw
    }
  }

  if (!best) return null
  return { draw: best, buffersById }
}

export function buildStats(selected: SelectedDraw) {
  const { draw, buffersById } = selected
  const attribs = (draw.attribs || []).slice().sort((a, b) => a.index - b.index)

  const pos = findPositionAttrib(attribs)
  const nrm = findNormalAttrib(attribs)
  const uv = findUvAttrib(attribs)

  const posBuf = pos ? buffersById.get(pos.bufferId) : null
  const idxBuf = draw.elementArrayBufferId ? buffersById.get(draw.elementArrayBufferId) : null

  return {
    chosenDraw: {
      kind: draw.kind,
      mode: draw.mode,
      count: draw.count,
      indexType: draw.indexType,
      indexTypeEnum: draw.indexTypeEnum,
      indexOffset: draw.indexOffset,
      elementArrayBufferId: draw.elementArrayBufferId,
    },
    guessedSemantics: {
      positionAttribIndex: pos?.index ?? null,
      normalAttribIndex: nrm?.index ?? null,
      uvAttribIndex: uv?.index ?? null,
    },
    buffers: {
      position: posBuf
        ? {
            id: posBuf.id,
            binOffset: posBuf.binOffset,
            byteLength: posBuf.byteLength,
            stride: pos?.stride,
            offset: pos?.offset,
            typeEnum: pos?.typeEnum,
            normalized: !!pos?.normalized,
          }
        : null,
      index: idxBuf
        ? {
            id: idxBuf.id,
            binOffset: idxBuf.binOffset,
            byteLength: idxBuf.byteLength,
          }
        : null,
    },
  }
}

export function buildGltf(captureBin: ArrayBuffer, selected: SelectedDraw, options: DecodeOptions): BuiltGltf {
  const { draw, buffersById } = selected
  const dv = new DataView(captureBin)
  const attribs = (draw.attribs || []).slice().sort((a, b) => a.index - b.index)

  const posA = findPositionAttrib(attribs)
  if (!posA) throw new Error('Could not find a POSITION-like attribute (size=3).')

  const nrmA = findNormalAttrib(attribs)
  const uvA = findUvAttrib(attribs)

  const posBuf = buffersById.get(posA.bufferId)
  if (!posBuf) throw new Error('Missing position buffer entry in JSON.')

  const idxBuf = draw.elementArrayBufferId ? buffersById.get(draw.elementArrayBufferId) : null
  if (!idxBuf) throw new Error('Missing index buffer entry in JSON.')

  const posStride = getStride(posA)
  const posOffset = posA.offset || 0
  const vertexCount = Math.floor((posBuf.byteLength - posOffset) / posStride)

  const { scale, biasX, biasY, biasZ, swapYZ, invertZ } = options

  const idxType = draw.indexTypeEnum
  const idxBpc = bytesPerComponent(idxType)
  const idxStart = idxBuf.binOffset + (draw.indexOffset || 0)
  const indexCount = draw.count

  const indices = new Uint32Array(indexCount)
  for (let i = 0; i < indexCount; i++) {
    indices[i] = readScalar(dv, idxStart + i * idxBpc, idxType)
  }

  const positions = new Float32Array(vertexCount * 3)
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  const posCompBytes = bytesPerComponent(posA.typeEnum)

  for (let i = 0; i < vertexCount; i++) {
    const base = posBuf.binOffset + posOffset + i * posStride

    let x = readScalar(dv, base + 0 * posCompBytes, posA.typeEnum)
    let y = readScalar(dv, base + 1 * posCompBytes, posA.typeEnum)
    let z = readScalar(dv, base + 2 * posCompBytes, posA.typeEnum)

    if (posA.normalized) {
      x = normalizeInt(x, posA.typeEnum)
      y = normalizeInt(y, posA.typeEnum)
      z = normalizeInt(z, posA.typeEnum)
    }

    x = x * scale + biasX
    y = y * scale + biasY
    z = z * scale + biasZ

    if (swapYZ) [y, z] = [z, y]
    if (invertZ) z = -z

    positions[i * 3 + 0] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  let normals: Float32Array | null = null
  let nrmMinMax: { min: number[]; max: number[] } | null = null
  if (nrmA) {
    const nrmBuf = buffersById.get(nrmA.bufferId)
    if (nrmBuf) {
      const nrmStride = getStride(nrmA)
      const nrmOffset = nrmA.offset || 0
      const nrmCount = Math.min(vertexCount, Math.floor((nrmBuf.byteLength - nrmOffset) / nrmStride))
      normals = new Float32Array(nrmCount * 3)

      const nrmCompBytes = bytesPerComponent(nrmA.typeEnum)
      for (let i = 0; i < nrmCount; i++) {
        const base = nrmBuf.binOffset + nrmOffset + i * nrmStride
        let nx = readScalar(dv, base + 0 * nrmCompBytes, nrmA.typeEnum)
        let ny = readScalar(dv, base + 1 * nrmCompBytes, nrmA.typeEnum)
        let nz = readScalar(dv, base + 2 * nrmCompBytes, nrmA.typeEnum)
        if (nrmA.normalized) {
          nx = normalizeInt(nx, nrmA.typeEnum)
          ny = normalizeInt(ny, nrmA.typeEnum)
          nz = normalizeInt(nz, nrmA.typeEnum)
        }
        normals[i * 3 + 0] = nx
        normals[i * 3 + 1] = ny
        normals[i * 3 + 2] = nz
      }
      nrmMinMax = { min: [-1, -1, -1], max: [1, 1, 1] }
    }
  }

  let uvs: Float32Array | null = null
  let uvMinMax: { min: number[]; max: number[] } | null = null
  if (uvA) {
    const uvBuf = buffersById.get(uvA.bufferId)
    if (uvBuf) {
      const uvStride = getStride(uvA)
      const uvOffset = uvA.offset || 0
      const uvCount = Math.min(vertexCount, Math.floor((uvBuf.byteLength - uvOffset) / uvStride))
      uvs = new Float32Array(uvCount * 2)

      const uvCompBytes = bytesPerComponent(uvA.typeEnum)
      let umin = Infinity
      let vmin = Infinity
      let umax = -Infinity
      let vmax = -Infinity

      for (let i = 0; i < uvCount; i++) {
        const base = uvBuf.binOffset + uvOffset + i * uvStride
        let u = readScalar(dv, base + 0 * uvCompBytes, uvA.typeEnum)
        let v = readScalar(dv, base + 1 * uvCompBytes, uvA.typeEnum)
        if (uvA.normalized) {
          u = normalizeInt(u, uvA.typeEnum)
          v = normalizeInt(v, uvA.typeEnum)
        }
        uvs[i * 2 + 0] = u
        uvs[i * 2 + 1] = v
        umin = Math.min(umin, u)
        vmin = Math.min(vmin, v)
        umax = Math.max(umax, u)
        vmax = Math.max(vmax, v)
      }
      uvMinMax = { min: [umin, vmin], max: [umax, vmax] }
    }
  }

  const chunks: Uint8Array[] = []
  const views: Record<string, { byteOffset: number; byteLength: number }> = {}
  let byteOffset = 0

  function pushChunk(name: string, typedArray: ArrayBufferView) {
    const align = 4
    const pad = (align - (byteOffset % align)) % align
    if (pad) {
      chunks.push(new Uint8Array(pad))
      byteOffset += pad
    }
    const u8 = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)
    views[name] = { byteOffset, byteLength: u8.byteLength }
    chunks.push(u8)
    byteOffset += u8.byteLength
  }

  pushChunk('indices', indices)
  pushChunk('positions', positions)
  if (normals) pushChunk('normals', normals)
  if (uvs) pushChunk('uvs', uvs)

  const binU8 = concatU8(chunks)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const binName = `mesh_${stamp}.bin`
  const gltfName = `mesh_${stamp}.gltf`

  const bufferViews: Record<string, unknown>[] = []
  const accessors: Record<string, unknown>[] = []

  function addBufferView(name: string, target?: number) {
    const view = views[name]
    const idx = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset: view.byteOffset,
      byteLength: view.byteLength,
      ...(target ? { target } : {}),
    })
    return idx
  }

  function addAccessor(args: {
    bufferView: number
    componentType: number
    count: number
    type: string
    min?: number[]
    max?: number[]
    normalized?: boolean
  }) {
    const idx = accessors.length
    const accessor: Record<string, unknown> = {
      bufferView: args.bufferView,
      componentType: args.componentType,
      count: args.count,
      type: args.type,
    }
    if (args.min) accessor.min = args.min
    if (args.max) accessor.max = args.max
    if (args.normalized) accessor.normalized = true
    accessors.push(accessor)
    return idx
  }

  const bvIndices = addBufferView('indices', 34963)
  const bvPositions = addBufferView('positions', 34962)
  const bvNormals = normals ? addBufferView('normals', 34962) : null
  const bvUVs = uvs ? addBufferView('uvs', 34962) : null

  const accIndices = addAccessor({
    bufferView: bvIndices,
    componentType: 5125,
    count: indices.length,
    type: 'SCALAR',
    min: [0],
    max: [maxOfU32(indices)],
  })

  const accPos = addAccessor({
    bufferView: bvPositions,
    componentType: 5126,
    count: vertexCount,
    type: 'VEC3',
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  })

  const accNrm = normals
    ? addAccessor({
        bufferView: bvNormals as number,
        componentType: 5126,
        count: normals.length / 3,
        type: 'VEC3',
        min: nrmMinMax?.min,
        max: nrmMinMax?.max,
      })
    : null

  const accUV = uvs
    ? addAccessor({
        bufferView: bvUVs as number,
        componentType: 5126,
        count: uvs.length / 2,
        type: 'VEC2',
        min: uvMinMax?.min,
        max: uvMinMax?.max,
      })
    : null

  const attributes: Record<string, number> = { POSITION: accPos }
  if (accNrm !== null) attributes.NORMAL = accNrm
  if (accUV !== null) attributes.TEXCOORD_0 = accUV

  const gltf = {
    asset: { version: '2.0', generator: 'WebGLDumpToGLTF' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'CapturedMesh' }],
    meshes: [
      {
        primitives: [
          {
            attributes,
            indices: accIndices,
            mode: 4,
          },
        ],
      },
    ],
    buffers: [{ uri: binName, byteLength: binU8.byteLength }],
    bufferViews,
    accessors,
  }

  return { gltfJsonObj: gltf, binU8, filenames: { gltf: gltfName, bin: binName } }
}

export function buildObj(captureBin: ArrayBuffer, selected: SelectedDraw, options: DecodeOptions) {
  const { draw, buffersById } = selected
  const dv = new DataView(captureBin)
  const attribs = (draw.attribs || []).slice().sort((a, b) => a.index - b.index)

  const posA = findPositionAttrib(attribs)
  if (!posA) throw new Error('Could not find a POSITION-like attribute (size=3).')

  const nrmA = findNormalAttrib(attribs)
  const uvA = findUvAttrib(attribs)

  const posBuf = buffersById.get(posA.bufferId)
  if (!posBuf) throw new Error('Missing position buffer entry in JSON.')

  const idxBuf = draw.elementArrayBufferId ? buffersById.get(draw.elementArrayBufferId) : null
  if (!idxBuf) throw new Error('Missing index buffer entry in JSON.')

  const idxType = draw.indexTypeEnum
  const idxBpc = bytesPerComponent(idxType)
  const idxStart = idxBuf.binOffset + (draw.indexOffset || 0)
  const idxCount = draw.count

  const posStride = getStride(posA)
  const posOffset = posA.offset || 0
  const posVertCount = Math.floor((posBuf.byteLength - posOffset) / posStride)

  const { scale, biasX, biasY, biasZ, swapYZ, invertZ } = options

  const vertices: number[][] = new Array(posVertCount)
  for (let i = 0; i < posVertCount; i++) {
    const base = posBuf.binOffset + posOffset + i * posStride

    let x = readScalar(dv, base + 0 * bytesPerComponent(posA.typeEnum), posA.typeEnum)
    let y = readScalar(dv, base + 1 * bytesPerComponent(posA.typeEnum), posA.typeEnum)
    let z = readScalar(dv, base + 2 * bytesPerComponent(posA.typeEnum), posA.typeEnum)

    if (posA.normalized) {
      x = normalizeInt(x, posA.typeEnum)
      y = normalizeInt(y, posA.typeEnum)
      z = normalizeInt(z, posA.typeEnum)
    }

    x = x * scale + biasX
    y = y * scale + biasY
    z = z * scale + biasZ

    if (swapYZ) [y, z] = [z, y]
    if (invertZ) z = -z

    vertices[i] = [x, y, z]
  }

  let normals: number[][] | null = null
  if (nrmA) {
    const nrmBuf = buffersById.get(nrmA.bufferId)
    if (nrmBuf) {
      const nrmStride = getStride(nrmA)
      const nrmOffset = nrmA.offset || 0
      const nrmVertCount = Math.min(posVertCount, Math.floor((nrmBuf.byteLength - nrmOffset) / nrmStride))
      normals = new Array(nrmVertCount)

      for (let i = 0; i < nrmVertCount; i++) {
        const base = nrmBuf.binOffset + nrmOffset + i * nrmStride
        let nx = readScalar(dv, base + 0 * bytesPerComponent(nrmA.typeEnum), nrmA.typeEnum)
        let ny = readScalar(dv, base + 1 * bytesPerComponent(nrmA.typeEnum), nrmA.typeEnum)
        let nz = readScalar(dv, base + 2 * bytesPerComponent(nrmA.typeEnum), nrmA.typeEnum)
        if (nrmA.normalized) {
          nx = normalizeInt(nx, nrmA.typeEnum)
          ny = normalizeInt(ny, nrmA.typeEnum)
          nz = normalizeInt(nz, nrmA.typeEnum)
        }
        normals[i] = [nx, ny, nz]
      }
    }
  }

  let uvs: number[][] | null = null
  if (uvA) {
    const uvBuf = buffersById.get(uvA.bufferId)
    if (uvBuf) {
      const uvStride = getStride(uvA)
      const uvOffset = uvA.offset || 0
      const uvVertCount = Math.min(posVertCount, Math.floor((uvBuf.byteLength - uvOffset) / uvStride))
      uvs = new Array(uvVertCount)

      for (let i = 0; i < uvVertCount; i++) {
        const base = uvBuf.binOffset + uvOffset + i * uvStride
        let u = readScalar(dv, base + 0 * bytesPerComponent(uvA.typeEnum), uvA.typeEnum)
        let v = readScalar(dv, base + 1 * bytesPerComponent(uvA.typeEnum), uvA.typeEnum)
        if (uvA.normalized) {
          u = normalizeInt(u, uvA.typeEnum)
          v = normalizeInt(v, uvA.typeEnum)
        }
        uvs[i] = [u, v]
      }
    }
  }

  const indices: number[] = new Array(idxCount)
  for (let i = 0; i < idxCount; i++) {
    const off = idxStart + i * idxBpc
    indices[i] = readScalar(dv, off, idxType)
  }

  let out = ''
  out += '# Generated from WebGL capture\n'
  out += `# vertices: ${vertices.length}\n`
  out += `# indices: ${indices.length} (triangles: ${Math.floor(indices.length / 3)})\n\n`

  for (const v of vertices) out += `v ${v[0]} ${v[1]} ${v[2]}\n`
  if (uvs) for (const t of uvs) out += `vt ${t[0]} ${t[1]}\n`
  if (normals) for (const n of normals) out += `vn ${n[0]} ${n[1]} ${n[2]}\n`

  out += '\n'

  const haveVT = !!uvs
  const haveVN = !!normals

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] + 1
    const b = indices[i + 1] + 1
    const c = indices[i + 2] + 1

    const A = Math.max(1, Math.min(a, vertices.length))
    const B = Math.max(1, Math.min(b, vertices.length))
    const C = Math.max(1, Math.min(c, vertices.length))

    if (haveVT && haveVN) {
      out += `f ${A}/${A}/${A} ${B}/${B}/${B} ${C}/${C}/${C}\n`
    } else if (haveVT && !haveVN) {
      out += `f ${A}/${A} ${B}/${B} ${C}/${C}\n`
    } else if (!haveVT && haveVN) {
      out += `f ${A}//${A} ${B}//${B} ${C}//${C}\n`
    } else {
      out += `f ${A} ${B} ${C}\n`
    }
  }

  return out
}

function findPositionAttrib(attribs: Attribute[]) {
  return attribs.find(
    (a) => a.size === 3 && (a.typeEnum === 5126 || (a.typeEnum === 5123 && !a.normalized)),
  )
}

function findNormalAttrib(attribs: Attribute[]) {
  return attribs.find((a) => a.size === 3 && a.normalized && (a.typeEnum === 5120 || a.typeEnum === 5122))
}

function findUvAttrib(attribs: Attribute[]) {
  return attribs.find((a) => a.size === 2 && a.normalized && (a.typeEnum === 5121 || a.typeEnum === 5123))
}

function getStride(attrib: Attribute) {
  return attrib.stride && attrib.stride !== 0 ? attrib.stride : attrib.size * bytesPerComponent(attrib.typeEnum)
}

function bytesPerComponent(typeEnum: number) {
  switch (typeEnum) {
    case 5120:
      return 1
    case 5121:
      return 1
    case 5122:
      return 2
    case 5123:
      return 2
    case 5124:
      return 4
    case 5125:
      return 4
    case 5126:
      return 4
    default:
      throw new Error(`Unsupported component type enum: ${typeEnum}`)
  }
}

function readScalar(dv: DataView, byteOffset: number, typeEnum: number, littleEndian = true) {
  switch (typeEnum) {
    case 5120:
      return dv.getInt8(byteOffset)
    case 5121:
      return dv.getUint8(byteOffset)
    case 5122:
      return dv.getInt16(byteOffset, littleEndian)
    case 5123:
      return dv.getUint16(byteOffset, littleEndian)
    case 5124:
      return dv.getInt32(byteOffset, littleEndian)
    case 5125:
      return dv.getUint32(byteOffset, littleEndian)
    case 5126:
      return dv.getFloat32(byteOffset, littleEndian)
    default:
      throw new Error(`Unsupported scalar type enum: ${typeEnum}`)
  }
}

function normalizeInt(val: number, typeEnum: number) {
  switch (typeEnum) {
    case 5120:
      return Math.max(-1, val / 127)
    case 5121:
      return val / 255
    case 5122:
      return Math.max(-1, val / 32767)
    case 5123:
      return val / 65535
    case 5124:
      return Math.max(-1, val / 2147483647)
    case 5125:
      return val / 4294967295
    default:
      return val
  }
}

function concatU8(chunks: Uint8Array[]) {
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

function maxOfU32(u32: Uint32Array) {
  let m = 0
  for (let i = 0; i < u32.length; i++) if (u32[i] > m) m = u32[i]
  return m
}
