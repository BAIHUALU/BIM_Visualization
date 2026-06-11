export const STATUS_META = {
  pending: {
    label: '未开始',
    color: '#98a2b3',
    material: '#9aa6b2'
  },
  in_progress: {
    label: '施工中',
    color: '#3f8cff',
    material: '#2f80ed'
  },
  completed: {
    label: '计划完成',
    color: '#00ff66',
    material: '#00e85c'
  },
  no_schedule: {
    label: '无计划',
    color: '#53606f',
    material: '#404a55'
  }
}

export const VARIANCE_META = {
  ahead: {
    label: '超前',
    color: '#25c2a0'
  },
  normal: {
    label: '正常',
    color: '#3f8cff'
  },
  warning: {
    label: '预警',
    color: '#f6c344'
  },
  delayed: {
    label: '滞后',
    color: '#f97066'
  },
  no_actual: {
    label: '未录入',
    color: '#8a97a8'
  }
}

export const DISPLAY_CATEGORIES = [
  '灌注桩',
  '管桩',
  '咬合桩',
  '钢板桩',
  '立柱桩',
  '钢围檩',
  '混凝土支撑',
  '钢支撑',
  '未分类'
]

export const DISPLAY_ZONES = [
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
  'E8',
  'E9',
  'E10',
  'E11',
  'E12',
  'E13',
  'W1',
  'W2',
  'W3',
  'W4',
  'W5',
  'W6',
  'unassigned'
]

export function getStatus(blockSchedule, currentDate) {
  if (!blockSchedule || !blockSchedule.start_date || !blockSchedule.end_date) {
    return 'no_schedule'
  }
  if (currentDate < blockSchedule.start_date) {
    return 'pending'
  }
  if (currentDate > blockSchedule.end_date) {
    return 'completed'
  }
  return 'in_progress'
}

export function hasSchedule(blockSchedule) {
  return Boolean(blockSchedule?.start_date && blockSchedule?.end_date)
}

export function buildZoneFallbackSchedules(modelBlocks, scheduleBlocks) {
  const fallback = {}
  Object.entries(modelBlocks || {}).forEach(([blockId, block]) => {
    const schedule = scheduleBlocks?.[blockId]
    if (!hasSchedule(schedule)) return

    const projectCurrent = fallback.__project_latest__
    const isProjectLater =
      !projectCurrent ||
      schedule.end_date > projectCurrent.end_date ||
      (schedule.end_date === projectCurrent.end_date && schedule.start_date > projectCurrent.start_date)
    if (isProjectLater) {
      fallback.__project_latest__ = {
        ...schedule,
        fallback_from_block_id: blockId,
        fallback_zone: 'project'
      }
    }

    if (!block?.zone || block.zone === 'unassigned') return

    const current = fallback[block.zone]
    const isLater =
      !current ||
      schedule.end_date > current.end_date ||
      (schedule.end_date === current.end_date && schedule.start_date > current.start_date)

    if (isLater) {
      fallback[block.zone] = {
        ...schedule,
        fallback_from_block_id: blockId,
        fallback_zone: block.zone
      }
    }
  })
  return fallback
}

export function resolveSchedule(blockId, zone, scheduleBlocks, zoneFallbackSchedules = {}) {
  const ownSchedule = scheduleBlocks?.[blockId]
  if (hasSchedule(ownSchedule)) return ownSchedule
  return zoneFallbackSchedules[zone] || zoneFallbackSchedules.__project_latest__ || ownSchedule
}

export function formatCount(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

export function clampPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.min(100, Math.max(0, numeric))
}

export function getPlanPercent(blockSchedule, currentDate) {
  if (!hasSchedule(blockSchedule)) return 0
  if (currentDate <= blockSchedule.start_date) return 0
  if (currentDate >= blockSchedule.end_date) return 100
  const start = new Date(`${blockSchedule.start_date}T00:00:00`).getTime()
  const end = new Date(`${blockSchedule.end_date}T00:00:00`).getTime()
  const current = new Date(`${currentDate}T00:00:00`).getTime()
  const span = Math.max(end - start, 86400000)
  return clampPercent(((current - start) / span) * 100)
}

export function getVarianceLevel(variance) {
  if (variance >= 5) return 'ahead'
  if (variance > -5) return 'normal'
  if (variance > -15) return 'warning'
  return 'delayed'
}

export function buildProgressRows(modelBlocks, scheduleBlocks, actualItems, currentDate, zoneFallbackSchedules = {}) {
  return Object.entries(modelBlocks || {})
    .map(([blockId, block]) => {
      const schedule = resolveSchedule(blockId, block?.zone, scheduleBlocks, zoneFallbackSchedules)
      const actual = actualItems?.[blockId] || {}
      const hasActual = actual.actual_percent !== undefined && actual.actual_percent !== null && actual.actual_percent !== ''
      const planPercent = getPlanPercent(schedule, currentDate)
      const actualPercent = hasActual ? clampPercent(actual.actual_percent) : 0
      const variance = actualPercent - planPercent
      const varianceLevel = getVarianceLevel(variance)
      return {
        block_id: blockId,
        zone: block?.zone || 'unassigned',
        category: block?.category || '未分类',
        mesh_count: block?.mesh_count || 0,
        schedule,
        plan_percent: Math.round(planPercent),
        actual_percent: actualPercent,
        variance,
        variance_level: varianceLevel,
        has_actual: hasActual,
        actual_start_date: actual.actual_start_date || '',
        actual_finish_date: actual.actual_finish_date || '',
        remark: actual.remark || ''
      }
    })
    .sort((a, b) => a.zone.localeCompare(b.zone, 'zh-CN') || a.category.localeCompare(b.category, 'zh-CN'))
}

export function summarizeVariance(rows) {
  const summary = {
    total: rows.length,
    recorded: 0,
    averagePlan: 0,
    averageActual: 0,
    distribution: {
      ahead: 0,
      normal: 0,
      warning: 0,
      delayed: 0,
      no_actual: 0
    },
    byZone: [],
    delayedRows: []
  }

  const zoneMap = new Map()
  rows.forEach((row) => {
    summary.averagePlan += row.plan_percent
    if (row.has_actual) {
      summary.recorded += 1
    }
    summary.averageActual += row.actual_percent
    summary.distribution[row.variance_level] += 1

    const zone = zoneMap.get(row.zone) || { zone: row.zone, count: 0, actualTotal: 0, planTotal: 0, recorded: 0 }
    zone.count += 1
    zone.planTotal += row.plan_percent
    zone.actualTotal += row.actual_percent
    if (row.has_actual) zone.recorded += 1
    zoneMap.set(row.zone, zone)
  })

  summary.averagePlan = rows.length ? Math.round(summary.averagePlan / rows.length) : 0
  summary.averageActual = rows.length ? Math.round(summary.averageActual / rows.length) : 0
  summary.byZone = Array.from(zoneMap.values())
    .map((zone) => ({
      zone: zone.zone,
      actual_percent: zone.count ? Math.round(zone.actualTotal / zone.count) : 0,
      plan_percent: zone.count ? Math.round(zone.planTotal / zone.count) : 0,
      coverage_percent: zone.count ? Math.round((zone.recorded / zone.count) * 100) : 0,
      variance_percent: zone.count ? Math.round(zone.actualTotal / zone.count - zone.planTotal / zone.count) : null,
      recorded: zone.recorded,
      count: zone.count
    }))
    .sort((a, b) => b.actual_percent - a.actual_percent)
  summary.zoneVarianceRank = [...summary.byZone]
    .filter((zone) => zone.variance_percent !== null)
    .sort((a, b) => a.variance_percent - b.variance_percent)
  summary.delayedRows = rows
    .filter((row) => row.variance_level === 'delayed' || row.variance_level === 'warning')
    .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
    .slice(0, 8)

  return summary
}

export function summarizeStatuses(modelBlocks, scheduleBlocks, currentDate, zoneFallbackSchedules = {}) {
  const summary = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    no_schedule: 0
  }
  Object.entries(modelBlocks || {}).forEach(([blockId, block]) => {
    const status = getStatus(resolveSchedule(blockId, block?.zone, scheduleBlocks, zoneFallbackSchedules), currentDate)
    summary[status] += 1
  })
  return summary
}

export function clampDate(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}
