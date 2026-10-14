/**
 * pending.js: what this browser holds that the reader vault does not, yet.
 *
 * Local storage is where everything is kept first (the meter's reads and top-ups, the notes, what was seen on the
 * wire); the reader vault gets it only when the reader presses Update the vault. Until then it exists in this browser
 * alone, and clearing the browser loses it. This module counts it, so the pane, the Vault button and the wire can say
 * so: "3 changes only in this browser". Nothing here writes.
 *
 * The count is every own record changed after the last update from this device (sgit.vault.last-sync): reads
 * started, rated or declined; top-ups; notes kept, given words or sent; stories seen. With no update ever, it is
 * every own record.
 *
 * @module pending
 */
import * as N from './notes.js'
import * as W from './wire-state.js'

export const LAST_SYNC = 'sgit.vault.last-sync'

function meterState() {
    let key = 'sgit.meter.v1'
    try { const el = document.getElementById('sg-meter-config'); if (el) key = JSON.parse(el.textContent).storageKey || key } catch (e) { /* default */ }
    try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null }
}
export function lastSync() { try { return localStorage.getItem(LAST_SYNC) || '' } catch (e) { return '' } }

/**
 * { count, reads, topups, notes, seen, any, last }. `count` is what the reader did (reads, top-ups, notes) and is the
 * number on the Vault button; `seen` is what the wire drew for them, which matters for what is new on another device
 * and is carried by the same update, but is not counted as something done; `any` is both.
 */
export function pending() {
    const last = lastSync(), after = at => !!at && (!last || String(at) > last)
    const st = meterState() || {}
    const reads = (st.log || []).filter(e => !e.device && (after(e.at) || after(e.rating && e.rating.at) || after(e.declined && e.declined.at))).length
    const topups = (st.topups || []).filter(t => !t.device && after(t.at)).length
    const notes = N.own().filter(n => after(n.at) || after(n.sent && n.sent.at) || after(n.edited)).length
    const seen = Object.values(W.own()).filter(e => after(e.at)).length
    return { count: reads + topups + notes, reads, topups, notes, seen, any: reads + topups + notes + seen, last }
}

/** In words, for a title or a line: "2 reads, 3 notes and 40 stories seen". */
export function describePending(p) {
    const parts = [[p.reads, 'read'], [p.topups, 'top-up'], [p.notes, 'note'], [p.seen, 'story seen on the wire', 'stories seen on the wire']]
        .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : (many || one + 's')}`)
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : (parts[0] || 'nothing')
}
