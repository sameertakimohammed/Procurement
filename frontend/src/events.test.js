import { describe, it, expect } from 'vitest'
import { renderDetail } from './events.js'

describe('renderDetail', () => {
  it('passes through null and strings', () => {
    expect(renderDetail(null)).toBe(null)
    expect(renderDetail('requires APPROVER')).toBe('requires APPROVER')
  })
  it('shows a reject reason', () => {
    expect(renderDetail({ reason: 'over budget' })).toBe('Reason: over budget')
  })
  it('renders a nested tier object as its role (no [object Object])', () => {
    const out = renderDetail({ estimated_amount: 10760, required_tier: { role: 'APPROVER', limit: 50000 } })
    expect(out).toBe('estimated_amount: 10760 · required_tier: APPROVER')
    expect(out).not.toContain('[object Object]')
  })
  it('falls back to compact JSON for other objects', () => {
    expect(renderDetail({ nested: { a: 1 } })).toBe('nested: {"a":1}')
  })
})
