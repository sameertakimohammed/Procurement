import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { money, num } from '../format.js'
import { canSuggestRequisition, mergeExplosion } from '../planning.js'

// Phase 4 — turn production demand into suggested purchasing. Add finished-good
// lines, preview the BOM explosion (gross → on-hand/available → net shortage →
// suggested buy with MOQ + vendor), then (OFFICER/ADMIN) raise ONE draft
// requisition that flows into the Phase 2 approval lifecycle. Preview is
// read-only; only the create action mutates.
export default function Planning() {
  const { user, setUser } = useAuth()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [costCenter, setCostCenter] = useState('')
  const [lines, setLines] = useState([]) // {sku, name, qty}
  const [preview, setPreview] = useState(null) // {gross, net, suggested}
  const [created, setCreated] = useState(null) // created requisition OR {created:false,message}
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const handle = setTimeout(() => {
      api.get(`/api/stock?q=${encodeURIComponent(q)}`)
        .then((d) => setResults(d?.results || []))
        .catch((e) => (e.status === 401 ? setUser(null) : setError(e.message)))
    }, 200)
    return () => clearTimeout(handle)
  }, [q, setUser])

  function addLine(r) {
    setLines((prev) => {
      if (prev.some((l) => l.sku === r.sku)) return prev
      return [...prev, { sku: r.sku, name: r.name, qty: 1 }]
    })
    setQ('')
    setResults([])
    setPreview(null)
    setCreated(null)
  }

  function updateLine(sku, patch) {
    setLines((prev) => prev.map((l) => (l.sku === sku ? { ...l, ...patch } : l)))
    setPreview(null)
    setCreated(null)
  }

  function removeLine(sku) {
    setLines((prev) => prev.filter((l) => l.sku !== sku))
    setPreview(null)
    setCreated(null)
  }

  function demandBody() {
    return { lines: lines.map((l) => ({ sku: l.sku, qty: Number(l.qty) })) }
  }

  function validate() {
    if (lines.length === 0) { setError('Add at least one finished good.'); return false }
    if (lines.some((l) => !(Number(l.qty) > 0))) {
      setError('Every line needs a quantity greater than zero.'); return false
    }
    return true
  }

  async function explode() {
    setError('')
    setCreated(null)
    if (!validate()) return
    setBusy('explode')
    try {
      setPreview(await api.post('/api/bom/explode', demandBody()))
    } catch (e) {
      if (e.status === 401) setUser(null)
      else setError(e.message) // 404 unknown SKU / 409 BOM cycle surface here
    } finally {
      setBusy('')
    }
  }

  async function suggest() {
    setError('')
    if (!validate()) return
    setBusy('suggest')
    try {
      const body = { ...demandBody(), cost_center: costCenter || undefined }
      setCreated(await api.post('/api/bom/suggest-requisition', body))
    } catch (e) {
      if (e.status === 401) setUser(null)
      else setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const rows = preview ? mergeExplosion(preview) : []
  const shortages = rows.filter((r) => r.shortage)
  const canCreate = canSuggestRequisition(user)
  // A created requisition has an id/number; "no shortages" comes back created:false.
  const createdReq = created && created.created !== false && created.id ? created : null

  return (
    <div>
      <div className="page-head">
        <h1>Planning</h1>
        <span className="muted">explode production demand into suggested purchasing</span>
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); explode() }}>
        <h2>Production demand</h2>

        <div className="form-row">
          <label className="field">
            <span className="field-label">Cost centre <span className="muted">(optional)</span></span>
            <input className="input" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="e.g. CC-100" />
          </label>
        </div>

        <div className="field">
          <span className="field-label">Add finished good</span>
          <input
            className="input"
            placeholder="Search any SKU or product name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <ul className="suggest">
            {results.slice(0, 8).map((r) => (
              <li key={r.sku}>
                <button type="button" className="suggest-item" onClick={() => addLine(r)}>
                  <span><strong>{r.sku}</strong> · {r.name}</span>
                  <span className="muted small">{r.item_type || ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>SKU</th><th>Product</th><th className="r">Build qty</th><th></th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.sku}>
                  <td>{l.sku}</td>
                  <td>{l.name}</td>
                  <td className="r">
                    <input
                      className="input qty"
                      type="number" min="0" step="any"
                      value={l.qty}
                      onChange={(e) => updateLine(l.sku, { qty: e.target.value })}
                    />
                  </td>
                  <td><button type="button" className="btn-link warn" onClick={() => removeLine(l.sku)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {error && <div className="error">{error}</div>}

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={!!busy || lines.length === 0}>
            {busy === 'explode' ? 'Exploding…' : 'Explode demand'}
          </button>
        </div>
        <p className="muted small">
          Explosion uses the active BOMs and live stock; preview is read-only. Buy quantities round
          shortages up to the chosen vendor's MOQ.
        </p>
      </form>

      {createdReq && (
        <div className="banner" style={{ background: 'var(--warn-bg)' }}>
          Draft requisition{' '}
          <Link to={`/requisitions/${createdReq.id}`}><strong>{createdReq.number}</strong></Link>{' '}
          created from this demand — open it to submit for approval.
        </div>
      )}
      {created && created.created === false && (
        <div className="banner">{created.message || 'No shortages — stock already covers this demand.'}</div>
      )}

      {preview && (
        <section className="card">
          <h2>
            Explosion preview{' '}
            <span className="muted small">
              {rows.length} material{rows.length === 1 ? '' : 's'} · {shortages.length} short
            </span>
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th>Material</th><th></th>
                <th className="r">Gross req</th>
                <th className="r">On hand</th><th className="r">Available</th>
                <th className="r">Net short</th>
                <th className="r">Suggested buy</th>
                <th className="r">MOQ</th><th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku} className={r.shortage ? 'row-warn' : ''}>
                  <td><Link to={`/stock/${r.sku}`}>{r.sku}</Link></td>
                  <td>{r.name}</td>
                  <td className="r">{num(r.gross)}</td>
                  <td className="r">{r.on_hand != null ? num(r.on_hand) : '—'}</td>
                  <td className="r">{r.available != null ? num(r.available) : '—'}</td>
                  <td className={`r ${r.shortage ? 'warn' : ''}`}>{r.net > 0 ? num(r.net) : '—'}</td>
                  <td className="r">{r.shortage ? <strong>{num(r.buy)}</strong> : '—'}</td>
                  <td className="r">{r.moq != null ? num(r.moq) : '—'}</td>
                  <td>{r.vendor || <span className="muted small">no vendor</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan="9" className="muted center-cell">Nothing to explode — these items have no BOM.</td></tr>
              )}
            </tbody>
          </table>

          <div className="form-actions" style={{ marginTop: 12 }}>
            {canCreate ? (
              <button
                className="btn btn-primary"
                disabled={!!busy || shortages.length === 0}
                onClick={suggest}
                title={shortages.length === 0 ? 'No shortages to purchase' : undefined}
              >
                {busy === 'suggest' ? 'Creating…' : 'Create suggested requisition'}
              </button>
            ) : (
              <span className="muted small">Only an officer or admin can raise a requisition from this demand.</span>
            )}
          </div>
          {canCreate && shortages.length === 0 && (
            <p className="muted small">No shortages — stock already covers this demand, so there is nothing to buy.</p>
          )}
        </section>
      )}
    </div>
  )
}

// Standalone, reusable BOM tree for a SKU (GET /api/items/:sku/bom). Rendered on
// the stock detail page; returns null for a purchased leaf (no BOM). Shows the
// owning system per node (APP kit vs mirrored KIWIPLAN/ACCURA material BOM, per
// CLAUDE.md §2).
export function BomTree({ sku }) {
  const { setUser } = useAuth()
  const [tree, setTree] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoaded(false)
    api.get(`/api/items/${encodeURIComponent(sku)}/bom`)
      .then((d) => { if (live) { setTree(d); setLoaded(true) } })
      .catch((e) => {
        if (!live) return
        if (e.status === 401) setUser(null)
        else setError(e.message)
        setLoaded(true)
      })
    return () => { live = false }
  }, [sku, setUser])

  if (error) return <div className="error">{error}</div>
  if (!loaded) return <p className="muted">Loading BOM…</p>
  // null tree, or a node with no components, = a purchased leaf material.
  if (!tree || !(tree.components && tree.components.length)) {
    return <p className="muted">No bill of materials — this is a purchased material.</p>
  }
  return (
    <ul className="bom-tree">
      {tree.components.map((c) => <BomNodeRow key={c.sku} node={c} depth={0} />)}
    </ul>
  )
}

function BomNodeRow({ node, depth }) {
  const children = node.components || []
  return (
    <li>
      <div className="bom-node" style={{ paddingLeft: depth * 18 }}>
        <span>
          <Link to={`/stock/${node.sku}`}><strong>{node.sku}</strong></Link>
          {' '}· {node.name}
        </span>
        <span className="muted small">
          {node.qty_per != null && <>×{num(node.qty_per)} per</>}
          {node.scrap_pct ? <> · {num(Number(node.scrap_pct) * 100)}% scrap</> : null}
          {node.owner && <> · <span className="chip">{node.owner}</span></>}
        </span>
      </div>
      {children.length > 0 && (
        <ul className="bom-tree">
          {children.map((c) => <BomNodeRow key={c.sku} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  )
}
