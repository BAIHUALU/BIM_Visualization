<template>
  <main class="app-shell">
    <header class="topbar panel platform-topbar">
      <div class="topbar-status">
        <span>当前日期</span>
        <strong>{{ currentDate }}</strong>
      </div>
      <div class="platform-title-frame">
        <p class="eyebrow">BIM 施工进度可视化</p>
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

    <section class="dashboard-grid">
      <aside class="left-rail">
        <section class="panel chart-panel">
          <div class="section-title">
            <span>区域完成对比</span>
          </div>
          <InsightChart type="zoneCompare" :summary="varianceSummary" />
        </section>

        <section class="panel chart-panel">
          <div class="section-title">
            <span>滞后区域排行</span>
          </div>
          <InsightChart type="zoneVarianceRank" :summary="varianceSummary" />
        </section>
      </aside>

      <section class="viewer-stage">
        <div class="viewer-stack">
          <BimViewer
            :key="`plan-${currentSection}`"
            viewer-id="plan-viewer"
            view-mode="plan"
            class="main-viewer"
            :model-blocks="sectionModelBlocks.blocks"
            :schedule-blocks="scheduleBlocks.blocks"
            :zone-fallback-schedules="zoneFallbackSchedules"
            :mesh-index="sectionModelBlocks.meshes"
            :actual-progress-items="actualProgress.items"
            :current-date="currentDate"
            :selected-zones="activeSelectedZones"
            :selected-categories="selectedCategories"
            :selected-block-id="selectedBlockId"
            :selected-mesh-id="selectedMeshId"
            :section-code="currentSection"
            :sync-camera-state="viewerCameraState"
            @select-mesh="handleSelectMesh"
            @camera-change="handleViewerCameraChange"
          />
          <BimViewer
            :key="`actual-${currentSection}`"
            viewer-id="actual-viewer"
            view-mode="actual"
            class="main-viewer"
            :model-blocks="sectionModelBlocks.blocks"
            :schedule-blocks="scheduleBlocks.blocks"
            :zone-fallback-schedules="zoneFallbackSchedules"
            :mesh-index="sectionModelBlocks.meshes"
            :actual-progress-items="actualProgress.items"
            :current-date="currentDate"
            :selected-zones="activeSelectedZones"
            :selected-categories="selectedCategories"
            :selected-block-id="selectedBlockId"
            :selected-mesh-id="selectedMeshId"
            :section-code="currentSection"
            :sync-camera-state="viewerCameraState"
            @select-mesh="handleSelectMesh"
            @camera-change="handleViewerCameraChange"
          />
        </div>

        <button class="floating-filter-button" @click="filterOpen = !filterOpen">
          {{ filterOpen ? '收起筛选' : '筛选' }}
        </button>

        <aside v-if="filterOpen" class="filter-popover panel">
          <section>
            <div class="section-title">
              <span>区域筛选</span>
              <button @click="selectedZones = []">全部</button>
            </div>
            <div class="chips compact">
              <label v-for="zone in zones" :key="zone" class="check-chip">
                <input v-model="selectedZones" type="checkbox" :value="zone" />
                <span>{{ zone === 'unassigned' ? '未归区' : zone }}</span>
              </label>
            </div>
          </section>
          <section>
            <div class="section-title">
              <span>分类筛选</span>
              <button @click="selectedCategories = []">全部</button>
            </div>
            <div class="chips">
              <label v-for="category in categories" :key="category" class="check-chip wide">
                <input v-model="selectedCategories" type="checkbox" :value="category" />
                <span>{{ category }}</span>
              </label>
            </div>
          </section>
          <section>
            <div class="section-title">
              <span>偏差图例</span>
            </div>
            <div class="legend-list">
              <div v-for="meta in varianceItems" :key="meta.label" class="legend-row">
                <i :style="{ background: meta.color }"></i>
                <span>{{ meta.label }}</span>
              </div>
            </div>
          </section>
        </aside>

        <aside v-if="selectedMesh" class="canvas-info panel">
          <p class="eyebrow">当前构件</p>
          <h2>{{ selectedBlock?.block_id || '未匹配板块' }}</h2>
          <div class="canvas-info-grid">
            <div>
              <span>区域</span>
              <strong>{{ selectedBlock?.zone || '-' }}</strong>
            </div>
            <div>
              <span>分类</span>
              <strong>{{ selectedBlock?.category || '-' }}</strong>
            </div>
            <div>
              <span>计划</span>
              <strong>{{ selectedSchedule?.start_date || '-' }} 至 {{ selectedSchedule?.end_date || '-' }}</strong>
            </div>
            <div>
              <span>实际完成</span>
              <strong>{{ selectedProgress?.has_actual ? `${selectedProgress.actual_percent}%` : '未录入（按 0% 计）' }}</strong>
            </div>
            <div>
              <span>偏差状态</span>
              <strong :style="{ color: selectedVarianceMeta.color }">{{ selectedVarianceMeta.label }}</strong>
            </div>
            <div>
              <span>构件数</span>
              <strong>{{ selectedBlock?.mesh_count ?? '-' }}</strong>
            </div>
          </div>
          <div class="mesh-card compact-card">
            <span>ElementID / 构件名称</span>
            <strong>{{ selectedMesh?.element_id || selectedMesh?.mesh_id || '-' }}</strong>
            <p>{{ selectedMesh?.name || '-' }}</p>
          </div>
        </aside>
      </section>

      <aside class="right-rail">
        <section class="panel delayed-panel">
          <div class="section-title">
            <span>重点风险板块</span>
          </div>
          <div class="focus-summary">
            <article v-for="item in executiveStats" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
          <div class="focus-list">
            <article v-for="row in focusRows" :key="row.block_id">
              <strong>{{ row.block_id }}</strong>
              <span>实际 {{ row.actual_percent }}% · 计划 {{ row.plan_percent }}% · 偏差 {{ formatVariance(row.variance) }}</span>
            </article>
            <p v-if="!focusRows.length" class="empty-text">暂无预警或滞后板块。</p>
          </div>
        </section>
      </aside>
    </section>

    <footer class="bottom-dock panel">
      <div class="timeline-control">
        <div>
          <span>时间轴</span>
          <strong>{{ currentDate }}</strong>
        </div>
        <input :value="dateToNumber(currentDate)" type="range" :min="dateRange.min" :max="dateRange.max" step="1" @input="syncRangeDate" />
        <input v-model="dateInput" type="date" :min="dateRange.minDate" :max="dateRange.maxDate" @change="syncInputDate" />
        <button class="admin-entry-button" @click="entryOpen = true">后台录入</button>
      </div>
    </footer>

    <div v-if="entryOpen" class="modal-backdrop">
      <section class="entry-modal panel">
        <section class="entry-panel">
          <div class="entry-toolbar">
            <div>
              <strong>实际进度批量录入</strong>
              <span>筛选结果 {{ entryFilteredRows.length }} 个 / 已选 {{ selectedEntryIds.length }} 个</span>
            </div>
          <div class="entry-actions">
            <button :disabled="!hasEntryFilter || !entryFilteredRows.length" @click="selectEntryFilteredRows">选择筛选结果</button>
            <button :disabled="!selectedBlockId" @click="selectCurrentBlock">选择当前构件板块</button>
            <button :disabled="!selectedBlock?.zone" @click="selectSameZone">选择同区域</button>
            <button :disabled="!selectedBlock?.category" @click="selectSameCategory">选择同分类</button>
            <button @click="selectedEntryIds = []">清空</button>
            <button @click="pasteOpen = true">Excel 粘贴导入</button>
            <button class="primary-button" :disabled="saving || !selectedEntryIds.length" @click="saveSelectedQuickProgress">
              保存选中
            </button>
            <button @click="entryOpen = false">关闭</button>
          </div>
        </div>
          <div class="entry-filter-bar">
            <label>
              区域
              <select v-model="entryFilters.zone">
                <option value="">全部</option>
                <option v-for="zone in zones" :key="zone" :value="zone">{{ zone === 'unassigned' ? '未归区' : zone }}</option>
              </select>
            </label>
            <label>
              分类
              <select v-model="entryFilters.category">
                <option value="">全部</option>
                <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
              </select>
            </label>
            <label>
              录入状态
              <select v-model="entryFilters.recordState">
                <option value="">全部</option>
                <option value="recorded">已录入</option>
                <option value="unrecorded">未录入</option>
              </select>
            </label>
            <label>
              偏差状态
              <select v-model="entryFilters.varianceLevel">
                <option value="">全部</option>
                <option v-for="meta in entryVarianceOptions" :key="meta.key" :value="meta.key">{{ meta.label }}</option>
              </select>
            </label>
            <button @click="resetEntryFilters">重置筛选</button>
          </div>
          <div class="quick-entry-bar">
            <span>快速设置选中板块：</span>
            <button v-for="percent in quickPercents" :key="percent" @click="setSelectedDraftPercent(percent)">
              {{ percent }}%
            </button>
            <label>
              完成日期
              <input v-model="quickFinishDate" type="date" />
            </label>
          </div>
          <p v-if="saveMessage" class="save-message">{{ saveMessage }}</p>
          <div class="entry-table-wrap">
            <table class="entry-table">
              <thead>
                <tr>
                  <th></th>
                  <th>板块</th>
                  <th>计划</th>
                  <th>实际</th>
                  <th>偏差</th>
                  <th>快速录入</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in entryFilteredRows" :key="row.block_id">
                  <td>
                    <input v-model="selectedEntryIds" type="checkbox" :value="row.block_id" />
                  </td>
                  <td>
                    <strong>{{ row.block_id }}</strong>
                    <span>{{ row.mesh_count }} 构件</span>
                  </td>
                  <td>{{ row.plan_percent }}%</td>
                  <td>{{ row.has_actual ? `${row.actual_percent}%` : '未录入（按 0% 计）' }}</td>
                  <td :style="{ color: VARIANCE_META[row.variance_level].color }">
                    {{ formatVariance(row.variance) }}
                  </td>
                  <td>
                    <div class="row-entry">
                      <input
                        :value="draftPercent(row)"
                        type="number"
                        min="0"
                        max="100"
                        @input="setDraftPercent(row.block_id, $event.target.value)"
                      />
                      <div class="quick-percent-row">
                        <button v-for="percent in quickPercents" :key="percent" @click="saveRowQuickProgress(row, percent)">
                          {{ percent }}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>

    <div v-if="pasteOpen" class="modal-backdrop">
      <section class="paste-modal panel">
        <div class="section-title">
          <span>Excel 粘贴导入</span>
          <button @click="closePasteModal">关闭</button>
        </div>
        <textarea
          v-model="pasteText"
          placeholder="从 Excel 复制包含表头的区域后粘贴到这里。支持：block_id/实际开始/实际完成日期/实际完成率/备注，或 区域/分类/实际开始/实际完成日期/实际完成率/备注。"
          @input="parsePasteText"
        ></textarea>
        <div class="import-summary">
          <span>可导入 {{ importStats.valid }} 行</span>
          <span>错误 {{ importStats.error }} 行</span>
          <span>重复 {{ importStats.duplicate }} 行</span>
        </div>
        <div class="import-table-wrap">
          <table class="entry-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>板块</th>
                <th>实际开始</th>
                <th>完成日期</th>
                <th>完成率</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in importPreviewRows" :key="row.rowKey" :class="{ invalid: row.errors.length }">
                <td>{{ row.errors.length ? '错误' : row.duplicate ? '重复' : '可导入' }}</td>
                <td>{{ row.block_id || '-' }}</td>
                <td>{{ row.actual_start_date || '-' }}</td>
                <td>{{ row.actual_finish_date || '-' }}</td>
                <td>{{ row.actual_percent }}</td>
                <td>{{ row.errors.join('；') || (row.duplicate ? '重复板块，以最后一行为准' : '校验通过') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button @click="closePasteModal">取消</button>
          <button class="primary-button" :disabled="saving || !canConfirmImport" @click="confirmImport">
            确认导入
          </button>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BimViewer from '../components/BimViewer.vue'
import InsightChart from '../components/InsightChart.vue'
import {
  loadActualProgress,
  loadBlockSchedule,
  loadModelBlocks,
  saveActualProgress
} from '../services/api'
import {
  DISPLAY_CATEGORIES,
  DISPLAY_ZONES,
  VARIANCE_META,
  buildProgressRows,
  buildZoneFallbackSchedules,
  clampDate,
  clampPercent,
  formatCount,
  summarizeVariance
} from '../utils/progress'
import { SECTION_META, createSectionQuery, filterModelPayloadBySection, getSectionZones, normalizeSection } from '../utils/sections'

const route = useRoute()
const router = useRouter()
const modelBlocks = ref({ blocks: {}, meshes: {}, summary: {} })
const scheduleBlocks = ref({ blocks: {}, summary: {} })
const actualProgress = ref({ items: {} })
const selectedZones = ref([])
const selectedCategories = ref([])
const selectedMesh = ref(null)
const viewerCameraState = ref(null)
const selectedEntryIds = ref([])
const currentDate = ref('2026-04-27')
const dateInput = ref(currentDate.value)
const filterOpen = ref(false)
const entryOpen = ref(false)
const pasteOpen = ref(false)
const pasteText = ref('')
const importPreviewRows = ref([])
const saving = ref(false)
const saveMessage = ref('')
const quickFinishDate = ref(currentDate.value)
const entryDrafts = ref({})
const entryFilters = ref({
  zone: '',
  category: '',
  recordState: '',
  varianceLevel: ''
})

const currentSection = computed(() => normalizeSection(route.query.section))
const sectionOptions = Object.values(SECTION_META)
const sectionQuery = computed(() => createSectionQuery(currentSection.value))
const zones = computed(() => getSectionZones(DISPLAY_ZONES, currentSection.value))
const activeSelectedZones = computed(() => (selectedZones.value.length ? selectedZones.value : zones.value))
const categories = DISPLAY_CATEGORIES
const varianceItems = Object.entries(VARIANCE_META)
  .filter(([key]) => key !== 'no_actual')
  .map(([, meta]) => meta)
const entryVarianceOptions = Object.entries(VARIANCE_META)
  .filter(([key]) => key !== 'no_actual')
  .map(([key, meta]) => ({ key, label: meta.label }))
const quickPercents = [0, 25, 50, 75, 100]
const datePattern = /^\d{4}-\d{2}-\d{2}$/

const dateRange = computed(() => {
  const minDate = '2026-01-01'
  const maxDate = '2026-12-31'
  return {
    minDate,
    maxDate,
    min: dateToNumber(minDate),
    max: dateToNumber(maxDate)
  }
})

const selectedBlockId = computed(() => selectedMesh.value?.block_id || '')
const selectedMeshId = computed(() => selectedMesh.value?.mesh_id || '')
const sectionModelBlocks = computed(() => filterModelPayloadBySection(modelBlocks.value, currentSection.value))
const selectedBlock = computed(() => sectionModelBlocks.value.blocks?.[selectedBlockId.value])
const selectedSchedule = computed(() => scheduleBlocks.value.blocks?.[selectedBlockId.value])
const zoneFallbackSchedules = computed(() => buildZoneFallbackSchedules(sectionModelBlocks.value.blocks, scheduleBlocks.value.blocks))
const progressRows = computed(() =>
  buildProgressRows(sectionModelBlocks.value.blocks, scheduleBlocks.value.blocks, actualProgress.value.items, currentDate.value, zoneFallbackSchedules.value)
)
const hasEntryFilter = computed(() => Object.values(entryFilters.value).some(Boolean))
const entryFilteredRows = computed(() =>
  progressRows.value.filter((row) => {
    const filters = entryFilters.value
    const zoneAllowed = !filters.zone || row.zone === filters.zone
    const categoryAllowed = !filters.category || row.category === filters.category
    const recordAllowed =
      !filters.recordState ||
      (filters.recordState === 'recorded' && row.has_actual) ||
      (filters.recordState === 'unrecorded' && !row.has_actual)
    const varianceAllowed = !filters.varianceLevel || row.variance_level === filters.varianceLevel
    return zoneAllowed && categoryAllowed && recordAllowed && varianceAllowed
  })
)
const varianceSummary = computed(() => summarizeVariance(progressRows.value))
const selectedProgress = computed(() => progressRows.value.find((row) => row.block_id === selectedBlockId.value))
const selectedVarianceMeta = computed(() => VARIANCE_META[selectedProgress.value?.variance_level || 'normal'])
const focusRows = computed(() => varianceSummary.value.delayedRows.slice(0, 8))
const executiveStats = computed(() => [
  {
    label: '实际录入',
    value: `${varianceSummary.value.recorded}/${varianceSummary.value.total}`
  },
  {
    label: '计划完成',
    value: `${varianceSummary.value.averagePlan}%`
  },
  {
    label: '实际完成',
    value: `${varianceSummary.value.averageActual}%`
  },
  {
    label: '预警/滞后',
    value: formatCount((varianceSummary.value.distribution.warning || 0) + (varianceSummary.value.distribution.delayed || 0))
  }
])
const importStats = computed(() => ({
  valid: importPreviewRows.value.filter((row) => !row.errors.length).length,
  error: importPreviewRows.value.filter((row) => row.errors.length).length,
  duplicate: importPreviewRows.value.filter((row) => row.duplicate).length
}))
const canConfirmImport = computed(() => importPreviewRows.value.length > 0 && importStats.value.valid > 0 && importStats.value.error === 0)

function dateToNumber(dateText) {
  return Math.floor(new Date(`${dateText}T00:00:00`).getTime() / 86400000)
}

function numberToDate(value) {
  return new Date(Number(value) * 86400000).toISOString().slice(0, 10)
}

function syncRangeDate(event) {
  currentDate.value = numberToDate(event.target.value)
  dateInput.value = currentDate.value
}

function syncInputDate() {
  currentDate.value = clampDate(dateInput.value, dateRange.value.minDate, dateRange.value.maxDate)
  dateInput.value = currentDate.value
}

function handleSelectMesh(mesh) {
  selectedMesh.value = mesh
}

function handleViewerCameraChange(state) {
  viewerCameraState.value = state
}

function switchSection(sectionCode) {
  router.push({ path: route.path, query: createSectionQuery(sectionCode) })
}

function formatVariance(value) {
  if (value === null || value === undefined) return '-'
  return `${value > 0 ? '+' : ''}${Math.round(value)}%`
}

function selectEntryFilteredRows() {
  if (!hasEntryFilter.value) return
  selectedEntryIds.value = entryFilteredRows.value.map((row) => row.block_id)
}

function selectCurrentBlock() {
  if (!selectedBlockId.value) return
  selectedEntryIds.value = [selectedBlockId.value]
}

function selectSameZone() {
  if (!selectedBlock.value?.zone) return
  selectedEntryIds.value = progressRows.value.filter((row) => row.zone === selectedBlock.value.zone).map((row) => row.block_id)
  entryFilters.value = {
    ...entryFilters.value,
    zone: selectedBlock.value.zone
  }
}

function selectSameCategory() {
  if (!selectedBlock.value?.category) return
  selectedEntryIds.value = progressRows.value.filter((row) => row.category === selectedBlock.value.category).map((row) => row.block_id)
  entryFilters.value = {
    ...entryFilters.value,
    category: selectedBlock.value.category
  }
}

function resetEntryFilters() {
  entryFilters.value = {
    zone: '',
    category: '',
    recordState: '',
    varianceLevel: ''
  }
}

function revealSavedEntryRows() {
  selectedEntryIds.value = []
  if (entryFilters.value.recordState === 'unrecorded') {
    saveMessage.value = '实际进度已保存并刷新图表。当前为“未录入”筛选，已保存的板块可能移出列表。'
  }
}

function draftPercent(row) {
  return entryDrafts.value[row.block_id] ?? row.actual_percent
}

function setDraftPercent(blockId, value) {
  entryDrafts.value = {
    ...entryDrafts.value,
    [blockId]: value
  }
}

function normalizeProgressItem(blockId, source) {
  return {
    block_id: blockId,
    actual_start_date: source.actual_start_date || '',
    actual_finish_date: source.actual_finish_date || '',
    actual_percent: clampPercent(source.actual_percent),
    remark: source.remark || '',
    updated_at: new Date().toISOString()
  }
}

async function persistActualProgress(nextItems) {
  saving.value = true
  saveMessage.value = ''
  try {
    await saveActualProgress({ items: nextItems })
    await refreshActualProgress()
    saveMessage.value = '实际进度已保存并刷新图表。'
    return true
  } catch (error) {
    const message = error.message || '保存失败。'
    saveMessage.value = message.includes('静态预览模式') ? `${message} 当前改动不会持久化。` : message
    return false
  } finally {
    saving.value = false
  }
}

async function saveSelectedQuickProgress() {
  if (!selectedEntryIds.value.length) return
  const nextItems = { ...(actualProgress.value.items || {}) }
  selectedEntryIds.value.forEach((blockId) => {
    const existing = nextItems[blockId] || {}
    const patch = {
      actual_percent: entryDrafts.value[blockId] ?? existing.actual_percent ?? 0,
      actual_finish_date: quickFinishDate.value,
      actual_start_date: existing.actual_start_date || quickFinishDate.value,
      remark: existing.remark || ''
    }
    nextItems[blockId] = normalizeProgressItem(blockId, {
      ...existing,
      ...patch
    })
  })
  const saved = await persistActualProgress(nextItems)
  if (saved) {
    entryDrafts.value = {}
    revealSavedEntryRows()
  }
}

async function saveRowQuickProgress(row, percent) {
  const nextItems = { ...(actualProgress.value.items || {}) }
  const existing = nextItems[row.block_id] || {}
  nextItems[row.block_id] = normalizeProgressItem(row.block_id, {
    ...existing,
    actual_start_date: existing.actual_start_date || quickFinishDate.value,
    actual_finish_date: quickFinishDate.value,
    actual_percent: percent,
    remark: existing.remark || ''
  })
  const saved = await persistActualProgress(nextItems)
  if (saved) {
    const { [row.block_id]: _removed, ...rest } = entryDrafts.value
    entryDrafts.value = rest
    revealSavedEntryRows()
  }
}

function setSelectedDraftPercent(percent) {
  if (!selectedEntryIds.value.length) return
  entryDrafts.value = selectedEntryIds.value.reduce(
    (drafts, blockId) => ({
      ...drafts,
      [blockId]: percent
    }),
    { ...entryDrafts.value }
  )
}

function closePasteModal() {
  pasteOpen.value = false
  pasteText.value = ''
  importPreviewRows.value = []
}

function getHeaderIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(header.trim().toLowerCase()))
}

function parsePasteText() {
  const lines = pasteText.value.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) {
    importPreviewRows.value = []
    return
  }

  const headers = lines[0].split('\t').map((header) => header.trim().toLowerCase())
  const indexes = {
    blockId: getHeaderIndex(headers, ['block_id', 'blockid', '板块', '板块id']),
    zone: getHeaderIndex(headers, ['区域', 'zone']),
    category: getHeaderIndex(headers, ['分类', 'category']),
    start: getHeaderIndex(headers, ['实际开始', '实际开始日期', 'actual_start_date']),
    finish: getHeaderIndex(headers, ['实际完成日期', '完成日期', 'actual_finish_date']),
    percent: getHeaderIndex(headers, ['实际完成率', '完成率', 'actual_percent']),
    remark: getHeaderIndex(headers, ['备注', 'remark'])
  }

  const seen = new Map()
  const parsed = lines.slice(1).map((line, index) => {
    const cells = line.split('\t').map((cell) => cell.trim())
    const read = (cellIndex) => (cellIndex >= 0 ? cells[cellIndex] || '' : '')
    const rawBlockId = read(indexes.blockId)
    const zone = read(indexes.zone)
    const category = read(indexes.category)
    const blockId = rawBlockId || (zone && category ? `${zone}|${category}` : '')
    const actualStart = read(indexes.start)
    const actualFinish = read(indexes.finish)
    const actualPercent = read(indexes.percent)
    const row = {
      rowKey: `${index}-${line}`,
      block_id: blockId,
      actual_start_date: actualStart,
      actual_finish_date: actualFinish,
      actual_percent: actualPercent,
      remark: read(indexes.remark),
      duplicate: false,
      errors: []
    }

    if (!blockId) row.errors.push('缺少 block_id 或区域+分类')
    if (blockId && !sectionModelBlocks.value.blocks?.[blockId]) row.errors.push('未匹配到当前标段板块')
    if (indexes.percent < 0 || actualPercent === '') row.errors.push('缺少实际完成率')
    if (actualPercent !== '' && (Number.isNaN(Number(actualPercent)) || Number(actualPercent) < 0 || Number(actualPercent) > 100)) {
      row.errors.push('实际完成率必须为 0-100')
    }
    if (actualStart && !datePattern.test(actualStart)) row.errors.push('实际开始日期格式应为 YYYY-MM-DD')
    if (actualFinish && !datePattern.test(actualFinish)) row.errors.push('实际完成日期格式应为 YYYY-MM-DD')
    if (blockId && seen.has(blockId)) {
      parsedDuplicate(seen.get(blockId))
      row.duplicate = true
    }
    if (blockId) seen.set(blockId, row)
    return row
  })

  importPreviewRows.value = parsed
}

function parsedDuplicate(row) {
  if (row) row.duplicate = true
}

async function confirmImport() {
  const nextItems = { ...(actualProgress.value.items || {}) }
  importPreviewRows.value
    .filter((row) => !row.errors.length)
    .forEach((row) => {
      nextItems[row.block_id] = normalizeProgressItem(row.block_id, row)
    })
  const saved = await persistActualProgress(nextItems)
  if (saved) {
    revealSavedEntryRows()
    closePasteModal()
  }
}

async function refreshActualProgress() {
  const actualPayload = await loadActualProgress()
  actualProgress.value = actualPayload
  return actualPayload
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
  dateInput.value = currentDate.value
}

watch(currentDate, (value) => {
  dateInput.value = value
  quickFinishDate.value = value
})

watch(
  currentSection,
  (section) => {
    if (route.query.section !== section) {
      router.replace({ path: route.path, query: createSectionQuery(section) })
    }
    selectedZones.value = []
    selectedMesh.value = null
    selectedEntryIds.value = []
    entryFilters.value = {
      ...entryFilters.value,
      zone: ''
    }
    refreshActualProgress()
  },
  { immediate: true }
)

watch(entryFilteredRows, (rows) => {
  const visibleIds = new Set(rows.map((row) => row.block_id))
  selectedEntryIds.value = selectedEntryIds.value.filter((blockId) => visibleIds.has(blockId))
})

onMounted(loadData)
</script>
