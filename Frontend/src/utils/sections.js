export const SECTION_CODES = ['E', 'W']

export const SECTION_META = {
  E: {
    code: 'E',
    label: 'E标段',
    description: 'E大区整体标段'
  },
  W: {
    code: 'W',
    label: 'W标段',
    description: 'W大区整体标段'
  }
}

export function normalizeSection(value) {
  const code = String(value || 'E').toUpperCase()
  return SECTION_CODES.includes(code) ? code : 'E'
}

export function isZoneInSection(zone, sectionCode) {
  return String(zone || '').toUpperCase().startsWith(normalizeSection(sectionCode))
}

export function getSectionZones(zones, sectionCode) {
  return (zones || []).filter((zone) => isZoneInSection(zone, sectionCode))
}

export function filterModelPayloadBySection(payload, sectionCode) {
  const code = normalizeSection(sectionCode)
  const blocks = {}
  Object.entries(payload?.blocks || {}).forEach(([blockId, block]) => {
    if (isZoneInSection(block?.zone, code)) blocks[blockId] = block
  })

  const blockIds = new Set(Object.keys(blocks))
  const meshes = {}
  Object.entries(payload?.meshes || {}).forEach(([meshId, mesh]) => {
    if (blockIds.has(mesh?.block_id) || isZoneInSection(mesh?.zone, code)) meshes[meshId] = mesh
  })

  return {
    ...payload,
    blocks,
    meshes,
    summary: {
      ...(payload?.summary || {}),
      section: code,
      block_count: Object.keys(blocks).length,
      mesh_count: Object.keys(meshes).length
    }
  }
}

export function createSectionQuery(sectionCode) {
  return { section: normalizeSection(sectionCode) }
}
