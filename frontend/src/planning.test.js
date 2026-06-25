import { describe, it, expect } from 'vitest'
import { canSuggestRequisition, mergeExplosion } from './planning.js'

const officer = { role: 'OFFICER' }
const admin = { role: 'ADMIN' }
const requester = { role: 'REQUESTER' }
const viewer = { role: 'VIEWER' }
const approver = { role: 'APPROVER' }

describe('canSuggestRequisition', () => {
  it('lets officer/admin create a suggested requisition', () => {
    expect(canSuggestRequisition(officer)).toBe(true)
    expect(canSuggestRequisition(admin)).toBe(true)
  })
  it('blocks requester/viewer/bare approver and null', () => {
    expect(canSuggestRequisition(requester)).toBe(false)
    expect(canSuggestRequisition(viewer)).toBe(false)
    expect(canSuggestRequisition(approver)).toBe(false)
    expect(canSuggestRequisition(null)).toBe(false)
  })
})

describe('mergeExplosion', () => {
  it('returns one row per gross material, in gross order', () => {
    const rows = mergeExplosion({
      gross: [{ sku: 'BOARD-200K', name: 'Board', qty: 6.2 }, { sku: 'GLUE-STARCH', name: 'Glue', qty: 0.2 }],
      net: [{ sku: 'BOARD-200K', name: 'Board', qty: 4 }],
      suggested: [{ sku: 'BOARD-200K', name: 'Board', qty: 5, on_hand: 2, available: 2.2, moq: 5, vendor: 'PaperCo' }],
    })
    expect(rows.map((r) => r.sku)).toEqual(['BOARD-200K', 'GLUE-STARCH'])
  })

  it('carries the suggested buy/MOQ/vendor onto the shortage row', () => {
    const [board] = mergeExplosion({
      gross: [{ sku: 'BOARD-200K', name: 'Board', qty: 6.2 }],
      net: [{ sku: 'BOARD-200K', name: 'Board', qty: 4 }],
      suggested: [{ sku: 'BOARD-200K', name: 'Board', qty: 5, on_hand: 2, available: 2.2, moq: 5, vendor: 'PaperCo' }],
    })
    expect(board).toMatchObject({
      gross: 6.2, net: 4, buy: 5, on_hand: 2, available: 2.2, moq: 5, vendor: 'PaperCo', shortage: true,
    })
  })

  it('a gross material covered by stock shows net 0, no buy, not a shortage', () => {
    const [glue] = mergeExplosion({
      gross: [{ sku: 'GLUE-STARCH', name: 'Glue', qty: 0.2 }],
      net: [],
      suggested: [],
    })
    expect(glue).toMatchObject({ gross: 0.2, net: 0, buy: 0, shortage: false, vendor: null, moq: null })
  })

  it('falls back to suggested/net name when gross row omits it', () => {
    const [row] = mergeExplosion({
      gross: [{ sku: 'WIRE-STITCH', qty: 0.05 }],
      net: [{ sku: 'WIRE-STITCH', name: 'Stitch wire', qty: 0.05 }],
      suggested: [{ sku: 'WIRE-STITCH', name: 'Stitch wire', qty: 1, moq: 1, vendor: 'WireCo' }],
    })
    expect(row.name).toBe('Stitch wire')
  })

  it('handles an empty/missing payload without throwing', () => {
    expect(mergeExplosion()).toEqual([])
    expect(mergeExplosion({})).toEqual([])
  })
})
