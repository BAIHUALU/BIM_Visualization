const configuredApiBase = import.meta.env.VITE_API_BASE
const API_BASE = configuredApiBase || (import.meta.env.DEV ? '' : null)

async function getJson(apiPath, fallbackPath, fallbackValue) {
  if (API_BASE !== null) {
    try {
      const response = await fetch(`${API_BASE}${apiPath}`)
      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      console.warn(`API fallback for ${apiPath}`, error)
    }
  }

  if (!fallbackPath) {
    return fallbackValue
  }

  try {
    const response = await fetch(fallbackPath)
    if (response.ok) {
      return await response.json()
    }
  } catch (error) {
    console.warn(`Static fallback failed for ${fallbackPath}`, error)
  }

  return fallbackValue
}

export function loadModelBlocks() {
  return getJson('/api/model-blocks', '/data/generated/model_blocks.json', {
    blocks: {},
    meshes: {},
    summary: {}
  })
}

export function loadBlockSchedule() {
  return getJson('/api/block-schedule', '/data/generated/block_schedule.json', {
    blocks: {},
    summary: {}
  })
}

export function loadAuditReport() {
  return getJson('/api/audit-report', '/data/generated/block_audit_report.json', {
    summary: {},
    model_without_schedule: [],
    schedule_without_model: []
  })
}

export function loadDashboardSummary() {
  return getJson('/api/dashboard-summary', null, {
    model: {},
    schedule: {},
    audit: {},
    actual_progress: { status: 'placeholder' }
  })
}

export function loadActualProgress() {
  return getJson('/api/actual-progress', null, {
    items: {},
    description: 'V1 placeholder'
  })
}

export async function saveActualProgress(payload) {
  if (API_BASE === null) {
    throw new Error('当前为静态预览模式，无法保存实际进度。请启动后端 API。')
  }

  const response = await fetch(`${API_BASE}/api/actual-progress`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.message || '实际进度保存失败')
  }
  return result
}
