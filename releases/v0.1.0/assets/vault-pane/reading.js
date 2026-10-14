/**
 * reading.js: what this browser knows about what it has read, from the meter's own records.
 *
 * The meter (sg-meter-core.js v1.4.0) keeps every read in local storage: { id, at, path, title, kind, depth, cost,
 * rating?, declined?, device? }. This module only reads that store and sums it up: for one page (how many times,
 * when, how far, what it cost, how it was rated) and for every page (the reading history, newest first). Nothing
 * here writes anything.
 *
 * @module reading
 */

function meterKey() {
    try { const el = document.getElementById('sg-meter-config'); if (el) { const c = JSON.parse(el.textContent); return c.storageKey || 'sgit.meter.v1' } } catch (e) { /* default */ }
    return 'sgit.meter.v1'
}
export function state() { try { return JSON.parse(localStorage.getItem(meterKey()) || 'null') } catch (e) { return null } }
export const reads = () => ((state() || {}).log || []).slice()
const r1 = x => Math.round(x * 10) / 10

/** How far, in words. */
export const depthWords = d => d >= 0.9 ? 'read it all' : d >= 0.6 ? 'read most of it' : d >= 0.3 ? 'read a third of it' : d > 0.05 ? 'glanced at it' : 'opened it'

/** One page: its reads summed up, or null when it was never read here. */
export function summary(path) {
    const rs = reads().filter(e => e.path === path).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    if (!rs.length) return null
    const last = rs[rs.length - 1]
    const rated = rs.filter(e => e.rating).pop()
    return {
        path, title: last.title || path, kind: last.kind || '', count: rs.length, first: rs[0].at, last: last.at,
        depth: Math.max(...rs.map(e => e.depth || 0)), cost: r1(rs.reduce((s, e) => s + (e.cost || 0), 0)),
        rating: rated ? rated.rating : null, declined: rs.some(e => e.declined), devices: [...new Set(rs.map(e => e.device || ''))],
    }
}

/** Every page read here, one entry each, by last read, newest first. */
export function history() {
    const byPath = new Map()
    for (const e of reads()) { if (!byPath.has(e.path)) byPath.set(e.path, summary(e.path)) }
    return [...byPath.values()].filter(Boolean).sort((a, b) => String(b.last).localeCompare(String(a.last)))
}
