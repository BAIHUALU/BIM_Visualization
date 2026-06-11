<template>
  <section :class="['viewer-shell', `viewer-shell-${viewMode}`]">
    <div ref="containerRef" class="viewer-canvas" />
    <div class="viewer-head">
      <div>
        <span class="eyebrow">{{ viewMode === 'actual' ? 'ACTUAL PROGRESS' : 'PLAN PROGRESS' }}</span>
        <strong>{{ modelLabel }}</strong>
      </div>
      <div class="viewer-status">
        <span :class="['dot', loading ? 'pulse' : '']"></span>
        {{ viewerStatusText }}
      </div>
    </div>
    <div v-if="error" class="viewer-error">{{ error }}</div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STATUS_META, getStatus, resolveSchedule } from '../utils/progress'

const ACTUAL_META = {
  unrecorded: { label: '未录入', material: '#8a97a8' },
  pending: { label: '实际未开始', material: '#9aa6b2' },
  in_progress: { label: '实际施工中', material: '#2f80ed' },
  completed: { label: '实际完成', material: '#00ff66' }
}

const props = defineProps({
  viewerId: {
    type: String,
    default: 'viewer'
  },
  viewMode: {
    type: String,
    default: 'plan',
    validator: (value) => ['plan', 'actual'].includes(value)
  },
  modelBlocks: {
    type: Object,
    default: () => ({})
  },
  scheduleBlocks: {
    type: Object,
    default: () => ({})
  },
  zoneFallbackSchedules: {
    type: Object,
    default: () => ({})
  },
  meshIndex: {
    type: Object,
    default: () => ({})
  },
  actualProgressItems: {
    type: Object,
    default: () => ({})
  },
  currentDate: {
    type: String,
    required: true
  },
  selectedZones: {
    type: Array,
    default: () => []
  },
  selectedCategories: {
    type: Array,
    default: () => []
  },
  selectedBlockId: {
    type: String,
    default: ''
  },
  selectedMeshId: {
    type: String,
    default: ''
  },
  sectionCode: {
    type: String,
    default: ''
  },
  syncCameraState: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['select-mesh', 'camera-change'])

const containerRef = ref(null)
const loading = ref(true)
const fullModelReady = ref(false)
const previewReady = ref(false)
const error = ref('')
const visibleMeshCount = ref(0)
const lightweightCount = ref(0)
const hiddenMeshCount = ref(0)

let renderer
let scene
let camera
let controls
let animationId
let resizeObserver
let lastRenderWidth = 0
let lastRenderHeight = 0
let raycaster
let pointer
let previewMesh
let pickingMesh
let completedBlockBoxMesh
let processedGroup
let processedMeshes = []
let previewItems = []
let previewItemByMeshId = new Map()
let manifest
let componentTexture
let componentTextureSize = 1
let componentColorData
let componentHidden = []
let componentLightweight = []
let completedBlockBoxItems = []
let selectedComponentId = -1
let disposed = false
let applyingCameraSync = false
let lastCameraEmit = 0

const matrix = new THREE.Matrix4()
const color = new THREE.Color()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const identityQuaternion = new THREE.Quaternion()
const skyColor = new THREE.Color('#b9ddf2')
const selectedColor = '#bdf838'

const selectedZoneSet = computed(() => new Set(props.selectedZones))
const selectedCategorySet = computed(() => new Set(props.selectedCategories))
const modelLabel = computed(() => {
  if (props.viewMode === 'actual') {
    return fullModelReady.value ? '实际进度视口' : '加载实际进度视口'
  }
  return fullModelReady.value ? '计划进度视口' : '加载计划进度视口'
})
const viewerStatusText = computed(() => {
  if (fullModelReady.value) {
    const suffix = lightweightCount.value || hiddenMeshCount.value ? ` / 板块盒 ${lightweightCount.value} / 隐藏 ${hiddenMeshCount.value}` : ''
    return `真实几何 ${visibleMeshCount.value}${suffix}`
  }
  if (previewReady.value) return `流畅预览 ${visibleMeshCount.value}`
  return '加载几何缓存'
})

function getActualStatus(meta) {
  const actual = props.actualProgressItems?.[meta?.block_id]
  const hasActual = actual?.actual_percent !== undefined && actual?.actual_percent !== null && actual?.actual_percent !== ''
  if (!hasActual) return 'unrecorded'
  const percent = Number(actual.actual_percent)
  if (!Number.isFinite(percent) || percent <= 0) return 'pending'
  if (percent >= 100) return 'completed'
  return 'in_progress'
}

function isActualCompleted(meta) {
  return props.viewMode === 'actual' && getActualStatus(meta) === 'completed'
}

function isPlanCompleted(meta) {
  if (props.viewMode !== 'plan') return false
  const schedule = resolveSchedule(meta?.block_id, meta?.zone, props.scheduleBlocks, props.zoneFallbackSchedules)
  return getStatus(schedule, props.currentDate) === 'completed'
}

function getStatusColor(meta, isSelected, isDimmed) {
  if (isSelected) {
    color.set(selectedColor)
  } else if (props.viewMode === 'actual') {
    const status = getActualStatus(meta)
    color.set(ACTUAL_META[status]?.material || ACTUAL_META.unrecorded.material)
  } else {
    const schedule = resolveSchedule(meta?.block_id, meta?.zone, props.scheduleBlocks, props.zoneFallbackSchedules)
    const status = getStatus(schedule, props.currentDate)
    color.set(STATUS_META[status]?.material || STATUS_META.no_schedule.material)
    if (fullModelReady.value && status === 'no_schedule') color.set('#58697a')
  }
  if (isDimmed) color.lerp(skyColor, 0.72)
  return color
}

function isMetaVisible(meta) {
  const zoneAllowed = !selectedZoneSet.value.size || selectedZoneSet.value.has(meta?.zone)
  const categoryAllowed = !selectedCategorySet.value.size || selectedCategorySet.value.has(meta?.category)
  return zoneAllowed && categoryAllowed
}

function getMeshMeta(meta) {
  return previewItemByMeshId.get(meta?.mesh_id) || props.meshIndex?.[meta?.mesh_id] || meta
}

function canUseLightweightBox(meta) {
  const source = getMeshMeta(meta)
  return (isActualCompleted(meta) || isPlanCompleted(meta)) && Array.isArray(source?.bbox_min) && Array.isArray(source?.bbox_max)
}

function createBlockBox(blockId, source, componentIndex, componentMeta, visualColor, isSelected) {
  return {
    blockId,
    representativeIndex: componentIndex,
    representativeMeta: componentMeta,
    min: [...source.bbox_min],
    max: [...source.bbox_max],
    color: visualColor.clone(),
    selected: isSelected
  }
}

function expandBlockBox(box, source, componentIndex, componentMeta, visualColor, isSelected) {
  for (let axis = 0; axis < 3; axis += 1) {
    box.min[axis] = Math.min(box.min[axis], source.bbox_min[axis])
    box.max[axis] = Math.max(box.max[axis], source.bbox_max[axis])
  }
  if (isSelected) {
    box.selected = true
    box.representativeIndex = componentIndex
    box.representativeMeta = componentMeta
    box.color = visualColor.clone()
  }
}

function applyVisualState() {
  const target = fullModelReady.value ? processedGroup : previewMesh
  if (!target) return

  let count = 0
  let lightweight = 0
  let hidden = 0
  if (fullModelReady.value) {
    const blockBoxes = new Map()
    manifest.components.forEach((meta, index) => {
      const isVisible = isMetaVisible(meta)
      const useLightweight = isVisible && canUseLightweightBox(meta)
      const isSelected = selectedComponentId === index
      const visualColor = getStatusColor(meta, isSelected, false)
      const offset = index * 4
      componentColorData[offset] = Math.round(visualColor.r * 255)
      componentColorData[offset + 1] = Math.round(visualColor.g * 255)
      componentColorData[offset + 2] = Math.round(visualColor.b * 255)
      componentColorData[offset + 3] = isVisible && !useLightweight ? 255 : 0
      componentHidden[index] = !isVisible || useLightweight
      componentLightweight[index] = useLightweight
      if (useLightweight) {
        const source = getMeshMeta(meta)
        const blockId = meta?.block_id || `component-${index}`
        const currentBox = blockBoxes.get(blockId)
        if (currentBox) {
          expandBlockBox(currentBox, source, index, meta, visualColor, isSelected)
        } else {
          blockBoxes.set(blockId, createBlockBox(blockId, source, index, meta, visualColor, isSelected))
        }
        hidden += 1
      }
      if (isVisible && !useLightweight) count += 1
    })
    completedBlockBoxItems = [...blockBoxes.values()]
    lightweight = completedBlockBoxItems.length
    componentTexture.needsUpdate = true
    updateCompletedBlockBoxes()
  } else {
    previewItems.forEach((meta, index) => {
      const isVisible = isMetaVisible(meta)
      const isSelected = selectedComponentId === index
      const center = meta.center || [0, 0, 0]
      const factor = isVisible ? (isSelected ? 1.85 : 1) : 0.42
      position.set(center[0], center[1], center[2])
      scale.copy(getPreviewSize(meta)).multiplyScalar(factor)
      matrix.compose(position, identityQuaternion, scale)
      previewMesh.setMatrixAt(index, matrix)
      previewMesh.setColorAt(index, getStatusColor(meta, isSelected, !isVisible))
      if (isVisible) count += 1
    })
    previewMesh.instanceMatrix.needsUpdate = true
    previewMesh.instanceColor.needsUpdate = true
  }
  visibleMeshCount.value = count
  lightweightCount.value = lightweight
  hiddenMeshCount.value = hidden
}

function getPreviewSize(meta) {
  const min = meta.bbox_min
  const max = meta.bbox_max
  if (Array.isArray(min) && Array.isArray(max)) {
    return scale.set(
      Math.max(Math.min(Math.abs(max[0] - min[0]), 8), 0.8),
      Math.max(Math.min(Math.abs(max[1] - min[1]), 4), 0.35),
      Math.max(Math.min(Math.abs(max[2] - min[2]), 8), 0.8)
    )
  }
  return scale.set(1.25, 1.25, 1.25)
}

function getLightweightSize(meta) {
  const min = meta.min || meta.bbox_min
  const max = meta.max || meta.bbox_max
  if (Array.isArray(min) && Array.isArray(max)) {
    return scale.set(
      Math.max(Math.abs(max[0] - min[0]), 1.2),
      Math.max(Math.abs(max[1] - min[1]), 0.8),
      Math.max(Math.abs(max[2] - min[2]), 1.2)
    )
  }
  return scale.set(2, 2, 2)
}

function ensurePreviewItems() {
  if (!previewItems.length) {
    previewItems = Object.values(props.meshIndex || {}).filter((item) => Array.isArray(item.center))
    previewItemByMeshId = new Map(previewItems.map((item) => [item.mesh_id, item]))
  }
  return previewItems
}

function createPickingProxy() {
  if (pickingMesh || !ensurePreviewItems().length) return
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false
  })
  pickingMesh = new THREE.InstancedMesh(geometry, material, previewItems.length)
  pickingMesh.frustumCulled = false
  previewItems.forEach((meta, index) => {
    const center = meta.center || [0, 0, 0]
    position.set(center[0], center[1], center[2])
    scale.copy(getPreviewSize(meta)).multiplyScalar(1.2)
    matrix.compose(position, identityQuaternion, scale)
    pickingMesh.setMatrixAt(index, matrix)
  })
  pickingMesh.instanceMatrix.needsUpdate = true
  pickingMesh.updateMatrixWorld(true)
}

function updateCompletedBlockBoxes() {
  if (!scene) return
  if (!completedBlockBoxMesh) {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.58,
      metalness: 0.02,
      vertexColors: true,
      emissive: '#00ff66',
      transparent: true,
      opacity: 0.94,
      emissiveIntensity: 0.72
    })
    completedBlockBoxMesh = new THREE.InstancedMesh(geometry, material, Math.max(manifest?.components?.length || 1, 1))
    completedBlockBoxMesh.frustumCulled = false
    completedBlockBoxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(completedBlockBoxMesh)
  }

  completedBlockBoxMesh.count = completedBlockBoxItems.length
  completedBlockBoxItems.forEach((item, index) => {
    position.set(
      (item.min[0] + item.max[0]) / 2,
      (item.min[1] + item.max[1]) / 2,
      (item.min[2] + item.max[2]) / 2
    )
    scale.copy(getLightweightSize(item)).multiplyScalar(item.selected ? 1.08 : 1)
    matrix.compose(position, identityQuaternion, scale)
    completedBlockBoxMesh.setMatrixAt(index, matrix)
    completedBlockBoxMesh.setColorAt(index, item.color)
  })
  completedBlockBoxMesh.instanceMatrix.needsUpdate = true
  if (completedBlockBoxMesh.instanceColor) completedBlockBoxMesh.instanceColor.needsUpdate = true
  completedBlockBoxMesh.updateMatrixWorld(true)
}

function createPreviewModel() {
  if (previewMesh || !scene) return
  if (!ensurePreviewItems().length) return

  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.72,
    metalness: 0.08,
    vertexColors: true
  })
  previewMesh = new THREE.InstancedMesh(geometry, material, previewItems.length)
  previewMesh.frustumCulled = false
  previewMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(previewMesh)
  previewReady.value = true
  applyVisualState()
  frameModel(previewMesh)
}

function createComponentTexture(componentCount) {
  componentTextureSize = Math.ceil(Math.sqrt(componentCount || 1))
  componentColorData = new Uint8Array(componentTextureSize * componentTextureSize * 4)
  componentTexture = new THREE.DataTexture(
    componentColorData,
    componentTextureSize,
    componentTextureSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  )
  componentTexture.magFilter = THREE.NearestFilter
  componentTexture.minFilter = THREE.NearestFilter
  componentTexture.generateMipmaps = false
  componentTexture.needsUpdate = true
  componentHidden = new Array(componentCount).fill(false)
  componentLightweight = new Array(componentCount).fill(false)
}

function getGeometryCacheRoots() {
  const section = String(props.sectionCode || '').toUpperCase()
  const roots = []
  if (section === 'E' || section === 'W') roots.push(`/models/processed/sections/${section}`)
  roots.push('/models/processed')
  return roots
}

function createProcessedMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      componentTexture: { value: componentTexture },
      componentTextureSize: { value: componentTextureSize }
    },
    vertexShader: `
      attribute float componentId;
      uniform sampler2D componentTexture;
      uniform float componentTextureSize;
      varying vec3 vNormal;
      varying vec4 vComponentColor;

      vec4 lookupComponent(float id) {
        float x = mod(id, componentTextureSize);
        float y = floor(id / componentTextureSize);
        vec2 uv = (vec2(x, y) + 0.5) / componentTextureSize;
        return texture2D(componentTexture, uv);
      }

      void main() {
        vComponentColor = lookupComponent(componentId);
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying vec3 vNormal;
      varying vec4 vComponentColor;

      void main() {
        if (vComponentColor.a < 0.05) discard;
        vec3 normalDir = normalize(vNormal);
        vec3 lightDir = normalize(vec3(0.35, 0.85, 0.45));
        float light = 0.68 + max(dot(normalDir, lightDir), 0.0) * 0.32;
        vec3 color = vComponentColor.rgb * light;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide
  })
}

function assertRange(buffer, range, bytesPerElement, label) {
  if (!range || range.byte_offset < 0 || range.byte_length < 0) {
    throw new Error(`${label} range 缺失`)
  }
  if (range.byte_offset % bytesPerElement !== 0 || range.byte_length % bytesPerElement !== 0) {
    throw new Error(`${label} range 未按 ${bytesPerElement} 字节对齐`)
  }
  if (range.byte_offset + range.byte_length > buffer.byteLength) {
    throw new Error(`${label} range 超出 chunk 大小：${range.byte_offset + range.byte_length}/${buffer.byteLength}`)
  }
}

function readFloat32(buffer, range, label) {
  assertRange(buffer, range, Float32Array.BYTES_PER_ELEMENT, label)
  return new Float32Array(buffer.slice(range.byte_offset, range.byte_offset + range.byte_length))
}

function readUint32(buffer, range, label) {
  assertRange(buffer, range, Uint32Array.BYTES_PER_ELEMENT, label)
  return new Uint32Array(buffer.slice(range.byte_offset, range.byte_offset + range.byte_length))
}

function buildChunkMesh(chunk, buffer) {
  const expectedSize = Math.max(...Object.values(chunk.attributes).map((range) => range.byte_offset + range.byte_length))
  if (buffer.byteLength !== expectedSize) {
    throw new Error(`${chunk.file} 文件尺寸不匹配：${buffer.byteLength}/${expectedSize}`)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(readFloat32(buffer, chunk.attributes.positions, `${chunk.file}.positions`), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(readFloat32(buffer, chunk.attributes.normals, `${chunk.file}.normals`), 3))
  geometry.setAttribute(
    'componentId',
    new THREE.BufferAttribute(Float32Array.from(readUint32(buffer, chunk.attributes.component_ids, `${chunk.file}.component_ids`)), 1)
  )
  geometry.setIndex(new THREE.BufferAttribute(readUint32(buffer, chunk.attributes.indices, `${chunk.file}.indices`), 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, createProcessedMaterial())
  mesh.frustumCulled = false
  return mesh
}

async function loadProcessedModel() {
  try {
    const cacheKey = Date.now()
    let geometryRoot = ''
    let manifestResponse
    for (const root of getGeometryCacheRoots()) {
      manifestResponse = await fetch(`${root}/geometry_manifest.json?v=${cacheKey}`, { cache: 'no-store' })
      if (manifestResponse.ok) {
        geometryRoot = root
        break
      }
    }
    if (!manifestResponse?.ok || !geometryRoot) throw new Error(`geometry_manifest.json ${manifestResponse?.status || 'missing'}`)
    manifest = await manifestResponse.json()
    if (!manifest?.components?.length || !manifest?.chunks?.length) {
      throw new Error('几何缓存 manifest 结构不完整')
    }

    ensurePreviewItems()
    createComponentTexture(manifest.components.length)
    processedGroup = new THREE.Group()
    processedMeshes = []
    applySelectedFromProps()
    applyVisualState()

    for (const chunk of manifest.chunks) {
      const response = await fetch(`${geometryRoot}/${chunk.file}?v=${manifest.generated_at || cacheKey}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`${chunk.file} ${response.status}`)
      const mesh = buildChunkMesh(chunk, await response.arrayBuffer())
      processedMeshes.push(mesh)
      processedGroup.add(mesh)
    }

    scene.add(processedGroup)
    createPickingProxy()

    if (previewMesh) {
      scene.remove(previewMesh)
      previewMesh.geometry.dispose()
      previewMesh.material.dispose()
      previewMesh = null
      previewReady.value = false
    }

    fullModelReady.value = true
    loading.value = false
    applySelectedFromProps()
    applyVisualState()
    frameModel(processedGroup)
  } catch (loadError) {
    error.value = `几何缓存缺失或加载失败：${loadError.message || loadError}。请运行 npm run preprocess:geometry 后刷新。`
    loading.value = false
    createPreviewModel()
  }
}

function frameModel(root) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  camera.position.set(center.x + maxDim * 0.55, center.y + maxDim * 0.42, center.z + maxDim * 0.95)
  camera.near = Math.max(maxDim / 1000, 0.1)
  camera.far = maxDim * 8
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
  emitCameraState(true)
}

function selectComponent(componentIndex, fallbackMeta) {
  selectedComponentId = componentIndex
  const meta = manifest?.components?.[componentIndex] || fallbackMeta
  emit('select-mesh', meta || null)
  applyVisualState()
}

function onPointerDown(event) {
  if (!renderer || !camera) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  if (fullModelReady.value && completedBlockBoxMesh?.count) {
    const boxHits = raycaster.intersectObject(completedBlockBoxMesh, false)
    if (boxHits.length && boxHits[0].instanceId !== undefined) {
      const item = completedBlockBoxItems[boxHits[0].instanceId]
      if (item) {
        selectComponent(item.representativeIndex, item.representativeMeta)
        return
      }
    }
  }

  if (fullModelReady.value && processedMeshes.length) {
    const hits = raycaster.intersectObjects(processedMeshes, false)
    for (const hit of hits) {
      const attribute = hit.object.geometry.getAttribute('componentId')
      const componentId = Math.round(attribute.getX(hit.face.a))
      if (!componentHidden[componentId]) {
        selectComponent(componentId)
        return
      }
    }
    if (pickingMesh) {
      const proxyHits = raycaster.intersectObject(pickingMesh, false)
      for (const hit of proxyHits) {
        if (hit.instanceId === undefined) continue
        const meta = previewItems[hit.instanceId]
        const componentIndex = manifest.components.findIndex((component) => component.mesh_id === meta?.mesh_id)
        if (meta && componentIndex >= 0 && (isMetaVisible(meta) || componentLightweight[componentIndex])) {
          selectComponent(componentIndex, meta)
          return
        }
      }
    }
    selectedComponentId = -1
    emit('select-mesh', null)
    applyVisualState()
    return
  }

  if (previewMesh) {
    const hits = raycaster.intersectObject(previewMesh)
    if (hits.length && hits[0].instanceId !== undefined) {
      selectedComponentId = hits[0].instanceId
      emit('select-mesh', previewItems[hits[0].instanceId])
      applyVisualState()
      return
    }
  }
  selectedComponentId = -1
  emit('select-mesh', null)
  applyVisualState()
}

function emitCameraState(force = false) {
  if (!camera || !controls || applyingCameraSync) return
  const now = performance.now()
  if (!force && now - lastCameraEmit < 80) return
  lastCameraEmit = now
  emit('camera-change', {
    source: props.viewerId,
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    zoom: camera.zoom,
    near: camera.near,
    far: camera.far,
    nonce: now
  })
}

function applyCameraState(state) {
  if (!state || state.source === props.viewerId || !camera || !controls) return
  applyingCameraSync = true
  if (Array.isArray(state.position)) camera.position.fromArray(state.position)
  if (Array.isArray(state.target)) controls.target.fromArray(state.target)
  if (Number.isFinite(state.zoom)) camera.zoom = state.zoom
  if (Number.isFinite(state.near)) camera.near = state.near
  if (Number.isFinite(state.far)) camera.far = state.far
  camera.updateProjectionMatrix()
  controls.update()
  applyingCameraSync = false
}

function applySelectedFromProps() {
  const selectedMeshId = props.selectedMeshId
  const selectedBlockId = props.selectedBlockId
  if (!selectedMeshId && !selectedBlockId) {
    selectedComponentId = -1
    return
  }
  if (manifest?.components?.length) {
    const meshMatch = selectedMeshId
      ? manifest.components.findIndex((component) => component.mesh_id === selectedMeshId)
      : -1
    selectedComponentId =
      meshMatch >= 0 ? meshMatch : manifest.components.findIndex((component) => component.block_id === selectedBlockId)
    return
  }
  selectedComponentId = selectedMeshId
    ? previewItems.findIndex((item) => item.mesh_id === selectedMeshId)
    : previewItems.findIndex((item) => item.block_id === selectedBlockId)
}

function animate() {
  if (disposed) return
  animationId = requestAnimationFrame(animate)
  resize()
  controls?.update()
  renderer?.render(scene, camera)
}

function resize() {
  if (!containerRef.value || !renderer || !camera) return
  const rect = containerRef.value.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  if (width === lastRenderWidth && height === lastRenderHeight) return
  lastRenderWidth = width
  lastRenderHeight = height
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(width, height, false)
  renderer.setViewport(0, 0, width, height)
  renderer.setScissorTest(false)
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
}

async function initViewer() {
  disposed = false
  await nextTick()
  const container = containerRef.value
  if (!container || disposed) return

  scene = new THREE.Scene()
  scene.background = skyColor
  scene.fog = new THREE.Fog('#b9ddf2', 900, 2400)

  const rect = container.getBoundingClientRect()
  const initialWidth = Math.max(1, Math.round(rect.width))
  const initialHeight = Math.max(1, Math.round(rect.height))

  camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 5000)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(initialWidth, initialHeight, false)
  renderer.setViewport(0, 0, initialWidth, initialHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = false
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  if (!container.isConnected || disposed) {
    renderer.dispose()
    renderer = null
    return
  }
  container.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = true
  controls.maxPolarAngle = Math.PI * 0.48
  controls.addEventListener('change', () => emitCameraState())

  scene.add(new THREE.HemisphereLight('#ffffff', '#7b8794', 2.4))
  const keyLight = new THREE.DirectionalLight('#ffffff', 2.1)
  keyLight.position.set(300, 500, 260)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight('#d8f0ff', 1.1)
  fillLight.position.set(-280, 180, -320)
  scene.add(fillLight)

  raycaster = new THREE.Raycaster()
  pointer = new THREE.Vector2()
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)

  loadProcessedModel()
  animate()
}

watch(
  () => [
    props.currentDate,
    props.selectedZones.join(','),
    props.selectedCategories.join(','),
    props.selectedBlockId,
    props.selectedMeshId,
    props.viewMode,
    Object.keys(props.scheduleBlocks).length,
    Object.keys(props.zoneFallbackSchedules).length,
    Object.keys(props.meshIndex).length,
    JSON.stringify(props.actualProgressItems)
  ],
  () => {
    if (fullModelReady.value && !pickingMesh) createPickingProxy()
    if (!previewMesh && !fullModelReady.value && !loading.value) createPreviewModel()
    ensurePreviewItems()
    applySelectedFromProps()
    applyVisualState()
  }
)

watch(
  () => props.syncCameraState,
  (state) => applyCameraState(state),
  { deep: true }
)

onMounted(initViewer)

onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(animationId)
  resizeObserver?.disconnect()
  renderer?.domElement?.removeEventListener('pointerdown', onPointerDown)
  previewMesh?.geometry.dispose()
  previewMesh?.material.dispose()
  pickingMesh?.geometry.dispose()
  pickingMesh?.material.dispose()
  completedBlockBoxMesh?.geometry.dispose()
  completedBlockBoxMesh?.material.dispose()
  processedMeshes.forEach((mesh) => {
    mesh.geometry.dispose()
    mesh.material.dispose()
  })
  componentTexture?.dispose()
  renderer?.dispose()
  controls?.dispose()
})
</script>
