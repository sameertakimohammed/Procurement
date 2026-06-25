// Pure helpers for the Planning page. The backend (POST /api/bom/explode) is the
// source of truth for the explosion + netting maths (it reuses
// backend/app/gateway/bom.py); these helpers only shape the response into the
// rows the table renders and gate the create-requisition button, so the UI stays
// honest about a user's role.

// Roles allowed to turn a demand signal into a suggested requisition.
// Contract (Phase 4): OFFICER / ADMIN mutate; VIEWER/REQUESTER/bare APPROVER 403.
export const PLANNER_ROLES = ['OFFICER', 'ADMIN']

// Can this user create a suggested requisition from a demand explosion?
export function canSuggestRequisition(user) {
  return !!user && PLANNER_ROLES.includes(user.role)
}

// Merge the three engine outputs (gross / net / suggested) — each a list keyed by
// sku — into one row per material for the preview table, in gross order.
//
// gross:      [{sku, name, qty}]          — total requirement before netting
// net:        [{sku, name, qty}]          — shortage after on-hand/on-order
// suggested:  [{sku, name, qty, on_hand, available, moq, vendor}]
//             — the buy quantity (net rounded up to the chosen-vendor MOQ)
//
// A material appears in `gross` but not `net`/`suggested` when stock already
// covers it; we still show it (net 0, no buy) so the user sees the full bill.
export function mergeExplosion({ gross = [], net = [], suggested = [] } = {}) {
  const netBySku = new Map(net.map((n) => [n.sku, n]))
  const sugBySku = new Map(suggested.map((s) => [s.sku, s]))
  return gross.map((g) => {
    const s = sugBySku.get(g.sku)
    const n = netBySku.get(g.sku)
    return {
      sku: g.sku,
      name: g.name ?? s?.name ?? n?.name ?? '',
      gross: Number(g.qty || 0),
      net: Number(n?.qty ?? 0),
      buy: s ? Number(s.qty || 0) : 0,
      on_hand: s?.on_hand ?? null,
      available: s?.available ?? null,
      moq: s?.moq ?? null,
      vendor: s?.vendor ?? null,
      shortage: !!s,
    }
  })
}
