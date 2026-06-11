import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import draco3d from 'draco3d'
import { MeshoptSimplifier } from 'meshop timizer'
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const modelPath = path.join(rootDir, 'public', 'models', 'Airport1.glb')
const modelBlocksPath = path.join(rootDir, 'public', 'data', 'generated', 'model_blocks.json')
const outputDir = path.join(rootDir, 'public', 'models', 'processed')
const sectionOutputRoot = path.join(outputDir, 'sections')

const MAX_CHUNK_VERTICES = 520000
const MAX_CHUNK_INDICES = 900000
const MAX_TRIANGLES_PER_PRIMITIVE = Number(process.env.GEOMETRY_MAX_TRIANGLES || 120)
const SIMPLIFY_TARGET_ERROR = Number(process.env.GEOMETRY_SIMPLIFY_ERROR || 0.015)

const vector = new Vector3()
const normalVector = new Vector3()
const normalMatrix = new Matrix3()

function readGlb(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${filePath} is not a binary glTF file`)
  let offset = 12
  let json = null
  let binary = null
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength)
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'))
    if (chunkType === 0x004e4942) binary = chunk
    offset += 8 + chunkLength
  }
  if (!json || !binary) throw new Error('GLB is missing JSON or BIN chunk')
  return { json, binary }
}

function asObject(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function findMetaValue(payload, keys) {
  if (!payload || typeof payload !== 'object') return null
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key]
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') {
      const found = findMetaValue(value, keys)
      if (found !== null && found !== undefined && found !== '') return found
    }
  }
  return null
}

function nodeLocalMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix)
  const translation = new Vector3(...(node.translation || [0, 0, 0]))
  const rotation = new Quaternion(...(node.rotation || [0, 0, 0, 1]))
  const scale = new Vector3(...(node.scale || [1, 1, 1]))
  return new Matrix4().compose(translation, rotation, scale)
}

function traverseNodes(gltf, visitor) {
  const scenes = gltf.scenes?.length ? gltf.scenes : [{ nodes: gltf.nodes.map((_, index) => index) }]
  const visited = new Set()
  function visit(nodeIndex, parentMatrix) {
    const node = gltf.nodes[nodeIndex]
    const worldMatrix = parentMatrix.clone().multiply(nodeLocalMatrix(node))
    visitor(node, worldMatrix)
    visited.add(nodeIndex)
    for (const child of node.children || []) visit(child, worldMatrix)
  }
  for (const scene of scenes) for (const nodeIndex of scene.nodes || []) visit(nodeIndex, new Matrix4())
  gltf.nodes.forEach((_, index) => {
    if (!visited.has(index)) visit(index, new Matrix4())
  })
}

function bufferViewBytes(gltf, binary, bufferViewIndex) {
  const view = gltf.bufferViews[bufferViewIndex]
  const start = view.byteOffset || 0
  return binary.subarray(start, start + view.byteLength)
}

function decodeAttribute(decoder, draco, mesh, attributeUniqueId) {
  const attribute = decoder.GetAttributeByUniqueId(mesh, attributeUniqueId)
  if (!attribute || !attribute.ptr) return null
  const values = new draco.DracoFloat32Array()
  decoder.GetAttributeFloatForAllPoints(mesh, attribute, values)
  const array = new Float32Array(values.size())
  for (let index = 0; index < values.size(); index += 1) array[index] = values.GetValue(index)
  draco.destroy(values)
  return array
}

function decodePrimitive(draco, decoder, binary, gltf, primitive) {
  const extension = primitive.extensions?.KHR_draco_mesh_compression
  if (!extension) return null
  const compressed = bufferViewBytes(gltf, binary, extension.bufferView)
  const decoderBuffer = new draco.DecoderBuffer()
  decoderBuffer.Init(new Int8Array(compressed), compressed.length)
  const mesh = new draco.Mesh()
  const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh)
  if (!status.ok()) {
    const message = status.error_msg()
    draco.destroy(mesh)
    draco.destroy(decoderBuffer)
    throw new Error(`Draco decode failed: ${message}`)
  }
  const positions = decodeAttribute(decoder, draco, mesh, extension.attributes.POSITION)
  const normals = extension.attributes.NORMAL !== undefined ? decodeAttribute(decoder, draco, mesh, extension.attributes.NORMAL) : null
  const indexCount = mesh.num_faces() * 3
  const indexBytes = indexCount * 4
  const indexPointer = draco._malloc(indexBytes)
  decoder.GetTrianglesUInt32Array(mesh, indexBytes, indexPointer)
  const indices = new Uint32Array(draco.HEAPU32.buffer, indexPointer, indexCount).slice()
  draco._free(indexPointer)
  draco.destroy(mesh)
  draco.destroy(decoderBuffer)
  if (!positions) return null
  return { positions, normals, indices }
}

function transformPrimitive(decoded, worldMatrix) {
  const vertexCount = decoded.positions.length / 3
  const positions = new Float32Array(decoded.positions.length)
  const normals = new Float32Array(decoded.positions.length)
  normalMatrix.getNormalMatrix(worldMatrix)
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3
    vector.set(decoded.positions[offset], decoded.positions[offset + 1], decoded.positions[offset + 2]).applyMatrix4(worldMatrix)
    positions[offset] = vector.x
    positions[offset + 1] = vector.y
    positions[offset + 2] = vector.z
    if (decoded.normals) {
      normalVector.set(decoded.normals[offset], decoded.normals[offset + 1], decoded.normals[offset + 2]).applyMatrix3(normalMatrix).normalize()
    } else {
      normalVector.set(0, 1, 0)
    }
    normals[offset] = normalVector.x
    normals[offset + 1] = normalVector.y
    normals[offset + 2] = normalVector.z
  }
  return { positions, normals, indices: decoded.indices }
}

function compactGeometry(geometry, sourceIndices) {
  const vertexMap = new Map()
  const positions = []
  const normals = []
  const indices = new Uint32Array(sourceIndices.length)
  function remapVertex(oldIndex) {
    if (vertexMap.has(oldIndex)) return vertexMap.get(oldIndex)
    const newIndex = vertexMap.size
    vertexMap.set(oldIndex, newIndex)
    const oldOffset = oldIndex * 3
    positions.push(geometry.positions[oldOffset], geometry.positions[oldOffset + 1], geometry.positions[oldOffset + 2])
    normals.push(geometry.normals[oldOffset], geometry.normals[oldOffset + 1], geometry.normals[oldOffset + 2])
    return newIndex
  }
  for (let index = 0; index < sourceIndices.length; index += 1) indices[index] = remapVertex(sourceIndices[index])
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices }
}

function simplifyGeometry(geometry) {
  if (!MAX_TRIANGLES_PER_PRIMITIVE || MAX_TRIANGLES_PER_PRIMITIVE <= 0) return geometry
  const triangleCount = geometry.indices.length / 3
  if (triangleCount <= MAX_TRIANGLES_PER_PRIMITIVE) return geometry
  const targetIndexCount = MAX_TRIANGLES_PER_PRIMITIVE * 3
  const [simplifiedIndices] = MeshoptSimplifier.simplify(
    geometry.indices,
    geometry.positions,
    3,
    targetIndexCount,
    SIMPLIFY_TARGET_ERROR,
    ['LockBorder']
  )
  if (!simplifiedIndices?.length || simplifiedIndices.length >= geometry.indices.length) return geometry
  return compactGeometry(geometry, simplifiedIndices)
}

function resolveMeshId(node, meshDef, fallbackIndex) {
  const elementId =
    findMetaValue(asObject(node.extras), ['ElementID', 'elementId', 'UniqueId', 'uniqueId']) ||
    findMetaValue(asObject(meshDef.extras), ['ElementID', 'elementId', 'UniqueId', 'uniqueId'])
  if (elementId !== null && elementId !== undefined && elementId !== '') return String(elementId)
  return `mesh-${fallbackIndex}-${node.name || meshDef.name || 'unnamed'}`
}

function createChunk(index) {
  return { index, positions: [], normals: [], componentIds: [], indices: [], vertexCount: 0, indexCount: 0, componentIdsInChunk: new Set() }
}

function appendGeometry(chunk, geometry, componentId) {
  const baseVertex = chunk.vertexCount
  chunk.positions.push(geometry.positions)
  chunk.normals.push(geometry.normals)
  const ids = new Uint32Array(geometry.positions.length / 3)
  ids.fill(componentId)
  chunk.componentIds.push(ids)
  const adjustedIndices = new Uint32Array(geometry.indices.length)
  for (let index = 0; index < geometry.indices.length; index += 1) adjustedIndices[index] = geometry.indices[index] + baseVertex
  chunk.indices.push(adjustedIndices)
  chunk.vertexCount += ids.length
  chunk.indexCount += adjustedIndices.length
  chunk.componentIdsInChunk.add(componentId)
}

function concatTypedArrays(parts, Type, totalLength) {
  const out = new Type(totalLength)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function align4(value) {
  return (value + 3) & ~3
}

function writeChunk(chunk, targetDir) {
  const positions = concatTypedArrays(chunk.positions, Float32Array, chunk.vertexCount * 3)
  const normals = concatTypedArrays(chunk.normals, Float32Array, chunk.vertexCount * 3)
  const componentIds = concatTypedArrays(chunk.componentIds, Uint32Array, chunk.vertexCount)
  const indices = concatTypedArrays(chunk.indices, Uint32Array, chunk.indexCount)
  const sections = [
    { name: 'positions', array: positions },
    { name: 'normals', array: normals },
    { name: 'component_ids', array: componentIds },
    { name: 'indices', array: indices }
  ]
  let byteOffset = 0
  const attributes = {}
  for (const section of sections) {
    byteOffset = align4(byteOffset)
    attributes[section.name] = { byte_offset: byteOffset, byte_length: section.array.byteLength }
    byteOffset += section.array.byteLength
  }
  const fileName = `geometry_chunk_${String(chunk.index).padStart(3, '0')}.bin`
  const output = Buffer.alloc(byteOffset)
  for (const section of sections) {
    const meta = attributes[section.name]
    Buffer.from(section.array.buffer, section.array.byteOffset, section.array.byteLength).copy(output, meta.byte_offset)
  }
  fs.writeFileSync(path.join(targetDir, fileName), output)
  return { file: fileName, vertex_count: chunk.vertexCount, index_count: chunk.indexCount, component_ids: [...chunk.componentIdsInChunk], attributes }
}

function cleanOutputDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(targetDir)) {
    if (entry.endsWith('.bin') || entry.endsWith('.json')) fs.rmSync(path.join(targetDir, entry), { force: true })
  }
}

function createBuildContext(label, targetDir) {
  return {
    label,
    targetDir,
    chunks: [],
    components: [],
    componentByMeshId: new Map(),
    unmatched: [],
    currentChunk: createChunk(0),
    primitiveCount: 0
  }
}

function getComponent(context, meshId, node, meshDef, meta) {
  if (context.componentByMeshId.has(meshId)) return context.componentByMeshId.get(meshId)
  if (!meta) context.unmatched.push(meshId)
  const componentId = context.components.length
  context.componentByMeshId.set(meshId, componentId)
  context.components.push({
    component_id: componentId,
    mesh_id: meshId,
    element_id: meta?.element_id || null,
    name: meta?.name || node.name || meshDef.name || '未命名构件',
    block_id: meta?.block_id || '',
    zone: meta?.zone || 'unassigned',
    category: meta?.category || '未分类'
  })
  return componentId
}

function appendToContext(context, geometry, componentId) {
  const vertexCount = geometry.positions.length / 3
  const indexCount = geometry.indices.length
  if (
    context.currentChunk.vertexCount &&
    (context.currentChunk.vertexCount + vertexCount > MAX_CHUNK_VERTICES || context.currentChunk.indexCount + indexCount > MAX_CHUNK_INDICES)
  ) {
    context.chunks.push(context.currentChunk)
    context.currentChunk = createChunk(context.chunks.length)
  }
  appendGeometry(context.currentChunk, geometry, componentId)
  context.primitiveCount += 1
}

function finalizeContext(context, baseManifest) {
  if (context.currentChunk.vertexCount) context.chunks.push(context.currentChunk)
  cleanOutputDir(context.targetDir)
  const manifest = {
    ...baseManifest,
    generated_at: new Date().toISOString(),
    section: context.label === 'full' ? null : context.label,
    component_count: context.components.length,
    primitive_count: context.primitiveCount,
    unmatched_mesh_ids: [...new Set(context.unmatched)],
    components: context.components,
    chunks: context.chunks.map((chunk) => writeChunk(chunk, context.targetDir))
  }
  fs.writeFileSync(path.join(context.targetDir, 'geometry_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

function getSectionCode(meta) {
  const zone = String(meta?.zone || '').toUpperCase()
  if (zone.startsWith('E')) return 'E'
  if (zone.startsWith('W')) return 'W'
  return null
}

async function main() {
  fs.mkdirSync(sectionOutputRoot, { recursive: true })
  const modelBlocks = JSON.parse(fs.readFileSync(modelBlocksPath, 'utf8'))
  const meshIndex = modelBlocks.meshes || {}
  const { json: gltf, binary } = readGlb(modelPath)
  const draco = await draco3d.createDecoderModule()
  await MeshoptSimplifier.ready
  const decoder = new draco.Decoder()
  const contexts = {
    full: createBuildContext('full', outputDir),
    E: createBuildContext('E', path.join(sectionOutputRoot, 'E')),
    W: createBuildContext('W', path.join(sectionOutputRoot, 'W'))
  }
  let fallbackIndex = 0

  traverseNodes(gltf, (node, worldMatrix) => {
    if (node.mesh === undefined) return
    const meshDef = gltf.meshes[node.mesh]
    const meshId = resolveMeshId(node, meshDef, fallbackIndex)
    fallbackIndex += 1
    const meta = meshIndex[meshId]
    const fullComponentId = getComponent(contexts.full, meshId, node, meshDef, meta)
    const sectionCode = getSectionCode(meta)
    const sectionContext = sectionCode ? contexts[sectionCode] : null
    const sectionComponentId = sectionContext ? getComponent(sectionContext, meshId, node, meshDef, meta) : null
    for (const primitive of meshDef.primitives || []) {
      const decoded = decodePrimitive(draco, decoder, binary, gltf, primitive)
      if (!decoded) continue
      const geometry = simplifyGeometry(transformPrimitive(decoded, worldMatrix))
      appendToContext(contexts.full, geometry, fullComponentId)
      if (sectionContext) appendToContext(sectionContext, geometry, sectionComponentId)
    }
  })

  const baseManifest = {
    version: 1,
    source_model: 'Airport1.glb',
    coordinate_system: 'three_world',
    lod: {
      max_triangles_per_primitive: MAX_TRIANGLES_PER_PRIMITIVE,
      simplify_target_error: SIMPLIFY_TARGET_ERROR,
      full_precision_command: "PowerShell: $env:GEOMETRY_MAX_TRIANGLES='0'; npm run preprocess:geometry"
    }
  }
  const manifests = Object.values(contexts).map((context) => finalizeContext(context, baseManifest))
  draco.destroy(decoder)
  console.log(
    JSON.stringify(
      manifests.map((manifest) => ({
        section: manifest.section || 'full',
        components: manifest.component_count,
        primitives: manifest.primitive_count,
        chunks: manifest.chunks.length,
        unmatched: manifest.unmatched_mesh_ids.length
      })),
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
