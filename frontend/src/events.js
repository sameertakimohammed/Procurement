// Render an order-event's detail_json for the audit timelines (requisitions, POs).
// detail can be a plain string, or an object of key/value pairs where a value may
// itself be an object (e.g. a tier {role, limit}). Object values are rendered
// readably instead of "[object Object]".
export function renderDetail(detail) {
  if (detail == null) return null
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object') {
    if (detail.reason) return `Reason: ${detail.reason}`
    return Object.entries(detail)
      .map(([k, v]) => `${k}: ${fmtValue(v)}`)
      .join(' · ')
  }
  return String(detail)
}

function fmtValue(v) {
  if (v == null) return '—'
  if (typeof v === 'object') {
    // an approval tier like {role, limit} reads best as just the role
    if (typeof v.role === 'string') return v.role
    return JSON.stringify(v)
  }
  return String(v)
}
