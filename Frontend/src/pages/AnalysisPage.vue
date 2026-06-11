<template>
  <main class="analysis-shell">
    <header class="topbar panel platform-topbar">
      <div class="topbar-status">
        <span>分析日期</span>
        <strong>{{ currentDate }}</strong>
      </div>
      <div class="platform-title-frame">
        <p class="eyebrow">{{ currentSectionMeta.label }}进度分析报告</p>
        <h1>深圳宝安国际机场T2航站区涉铁地下工程数字化平台</h1>
      </div>
      <div class="topbar-meta">
        <nav class="page-tabs">
          <RouterLink :to="{ path: '/', query: sectionQuery }">整体进度</RouterLink>
          <RouterLink :to="{ path: '/analysis', query: sectionQuery }">进度分析</RouterLink>
        </nav>
        <div class="section-switch">
          <button
            v-for="item in sectionOptions"
            :key="item.code"
            :class="{ active: currentSection === item.code }"
            @click="switchSection(item.code)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    </header>

    <section class="analysis-layout">
      <section class="analysis-viewer panel">
        <BimViewer
          :key="`analysis-${currentSection}`"
          viewer-id="analysis-viewer"
          view-mode="actual"
          class="main-viewer"
          :model-blocks="sectionModelBlocks.blocks"
          :schedule-blocks="scheduleBlocks.blocks"
          :zone-fallback-schedules="zoneFallbackSchedules"
          :mesh-index="sectionModelBlocks.meshes"
          :actual-progress-items="actualProgress.items"
          :current-date="currentDate"
          :selected-zones="sectionZones"
          :selected-categories="[]"
          :selected-block-id="selectedBlockId"
          :selected-mesh-id="selectedMeshId"
          :section-code="currentSection"
          @select-mesh="handleSelectMesh"
        />
      </section>

      <section class="analysis-report panel">
        <div class="report-head">
          <div>
            <p class="eyebrow">PROGRESS ANALYSIS</p>
            <h2>{{ currentSectionMeta.description }}进度分析</h2>
          </div>
          <div class="report-kpis">
            <article v-for="item in reportKpis" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
        </div>

        <div class="report-body">
          <article>
            <h3>总体判断</h3>
            <p>{{ reportSummary }}</p>
          </article>
          <article>
            <h3>主要风险</h3>
            <p>{{ riskSummary }}</p>
          </article>
          <article>
            <h3>核查建议</h3>
            <p>{{ actionSummary }}</p>
          </article>
          <article v-if="focusRows.length">
            <h3>重点板块</h3>
            <ul>
              <li v-for="row in focusRows" :key="row.block_id">
                {{ row.block_id }}：实际 {{ row.actual_percent }}%，计划 {{ row.plan_percent }}%，偏差 {{ formatVariance(row.variance) }}
              </li>
            </ul>
          </article>
        </div>
      </section>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BimViewer from '../components/BimViewer.vue'
import { loadActualProgress, loadBlockSchedule, loadModelBlocks } from '../services/api'
import {
  buildProgressRows,
  buildZoneFallbackSchedules,
  formatCount,
  summarizeVariance
} from '../utils/progress'
import {
  DISPLAY_ZONES
} from '../utils/progress'
import { SECTION_META, createSectionQuery, filterModelPayloadBySection, getSectionZones, normalizeSection } from '../utils/sections'

const route = useRoute()
const router = useRouter()
const modelBlocks = ref({ blocks: {}, meshes: {}, summary: {} })
const scheduleBlocks = ref({ blocks: {}, summary: {} })
const actualProgress = ref({ items: {} })
const selectedMesh = ref(null)
const currentDate = ref('2026-04-27')

const currentSection = computed(() => normalizeSection(route.query.section))
const currentSectionMeta = computed(() => SECTION_META[currentSection.value])
const sectionOptions = Object.values(SECTION_META)
const sectionQuery = computed(() => createSectionQuery(currentSection.value))
const sectionZones = computed(() => getSectionZones(DISPLAY_ZONES, currentSection.value))
const sectionModelBlocks = computed(() => filterModelPayloadBySection(modelBlocks.value, currentSection.value))
const zoneFallbackSchedules = computed(() => buildZoneFallbackSchedules(sectionModelBlocks.value.blocks, scheduleBlocks.value.blocks))
const progressRows = computed(() =>
  buildProgressRows(sectionModelBlocks.value.blocks, scheduleBlocks.value.blocks, actualProgress.value.items, currentDate.value, zoneFallbackSchedules.value)
)
const varianceSummary = computed(() => summarizeVariance(progressRows.value))
const focusRows = computed(() => varianceSummary.value.delayedRows.slice(0, 6))
const selectedBlockId = computed(() => selectedMesh.value?.block_id || '')
const selectedMeshId = computed(() => selectedMesh.value?.mesh_id || '')
const delayedCount = computed(() => (varianceSummary.value.distribution.warning || 0) + (varianceSummary.value.distribution.delayed || 0))
const lagValue = computed(() => varianceSummary.value.averageActual - varianceSummary.value.averagePlan)
const reportKpis = computed(() => [
  { label: '计划完成', value: `${varianceSummary.value.averagePlan}%` },
  { label: '实际完成', value: `${varianceSummary.value.averageActual}%` },
  { label: '录入覆盖', value: `${varianceSummary.value.recorded}/${varianceSummary.value.total}` },
  { label: '预警/滞后', value: formatCount(delayedCount.value) }
])
const reportSummary = computed(() => {
  const lag = formatVariance(lagValue.value)
  return `${currentSectionMeta.value.label}截至 ${currentDate.value}，计划平均完成 ${varianceSummary.value.averagePlan}%，实际平均完成 ${varianceSummary.value.averageActual}%，整体偏差 ${lag}。当前已录入 ${varianceSummary.value.recorded}/${varianceSummary.value.total} 个板块，未录入部分按 0% 参与偏差计算。`
})
const riskSummary = computed(() => {
  if (!focusRows.value.length) return '当前标段暂无明显预警或滞后板块，建议继续保持常规巡检和录入更新。'
  const zones = [...new Set(focusRows.value.map((row) => row.zone))].join('、')
  return `当前主要风险集中在 ${zones}，共 ${delayedCount.value} 个板块处于预警或滞后状态，其中 ${focusRows.value[0].block_id} 偏差最大。`
})
const actionSummary = computed(() => {
  if (!focusRows.value.length) return '建议保持周度录入节奏，并在关键节点复核计划与现场完成口径。'
  return '建议优先核查重点风险板块的现场完成情况和后台录入完整性；若现场已完成，应及时补录实际进度，若现场未完成，应更新施工组织和资源投入计划。'
})

function switchSection(sectionCode) {
  router.push({ path: '/analysis', query: createSectionQuery(sectionCode) })
}

function handleSelectMesh(mesh) {
  selectedMesh.value = mesh
}

function formatVariance(value) {
  if (value === null || value === undefined) return '-'
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`
}

async function loadData() {
  const [modelPayload, schedulePayload, actualPayload] = await Promise.all([
    loadModelBlocks(),
    loadBlockSchedule(),
    loadActualProgress()
  ])
  modelBlocks.value = modelPayload
  scheduleBlocks.value = schedulePayload
  actualProgress.value = actualPayload
}

watch(
  currentSection,
  (section) => {
    if (route.query.section !== section) router.replace({ path: '/analysis', query: createSectionQuery(section) })
    selectedMesh.value = null
  },
  { immediate: true }
)

onMounted(loadData)
</script>
