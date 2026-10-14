/**
 * wire-state.js: what this browser knows about the Industry Wire, kept locally like every other record.
 *
 *   seen     story id -> { at, device? }: when this reader first saw the story drawn, in this browser or (tagged with
 *            the device) on another of their devices, brought in through the vault
 *   visits   when the last visit started, so the page can say what arrived since; a visit lasts for the tab
 *   lens     the persona the reader chose to read the wire as, remembered between visits
 *
 * A story is NEW when it was first seen during this visit: it had not been drawn for this reader before, on this
 * device or on any device whose activity was brought in. Reloading the page keeps the visit, so a reload does not
 * clear what is new; a new tab or a new day starts a new visit.
 *
 * Like the notes, this is kept in local storage as it happens and carried to the reader vault only when the reader
 * presses Update the vault (assets/vault-pane/sync.js). The design: admin/notes/2026-10-13__the-wire-as-an-inbox.md.
 *
 * @module wire-state
 */

export const STORE = 'sgit.wire.v1', SESSION = 'sgit.wire.visit', FORMAT = 1, EVENT = 'sgit-wire'
const emit = detail => { try { window.dispatchEvent(new CustomEvent(EVENT, { detail })) } catch (e) { /* no window */ } }

export function read() {
    try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && typeof s.seen === 'object' && s.seen) return { v: FORMAT, seen: s.seen, last_visit: s.last_visit || null, lens: s.lens || '' } } catch (e) { /* fall through */ }
    return { v: FORMAT, seen: {}, last_visit: null, lens: '' }
}
export function write(s) { localStorage.setItem(STORE, JSON.stringify({ v: FORMAT, seen: s.seen || {}, last_visit: s.last_visit || null, lens: s.lens || '' })) }

/** This visit: { start, prev }. The first call in a tab starts a visit and moves last_visit; later calls in the tab return the same. */
export function visit(now = new Date().toISOString()) {
    try { const v = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); if (v && v.start) return v } catch (e) { /* new visit */ }
    const s = read()
    const v = { start: now, prev: s.last_visit || null }
    s.last_visit = now
    try { write(s) } catch (e) { /* no storage: the visit lives in memory */ }
    try { sessionStorage.setItem(SESSION, JSON.stringify(v)) } catch (e) { /* fine */ }
    return v
}

/** Record the stories drawn for this reader; returns the ids seen for the first time. */
export function markSeen(ids, now = new Date().toISOString()) {
    const s = read(), added = []
    for (const id of ids) if (id && !s.seen[id]) { s.seen[id] = { at: now }; added.push(id) }
    if (added.length) { try { write(s); emit({ what: 'seen', ids: added }) } catch (e) { /* fine */ } }
    return added
}

/** New in this visit: first seen at or after the visit started, here (never brought in from another device). */
export function isNew(id, v, s = read()) { const e = s.seen[id]; return !!e && !e.device && !!v && String(e.at) >= String(v.start) }

export const lens = () => read().lens || ''
export function setLens(id) { const s = read(); s.lens = id || ''; try { write(s) } catch (e) { /* fine */ } }

/** This device's own seen entries, for its file in the reader vault. */
export const own = (s = read()) => Object.fromEntries(Object.entries(s.seen).filter(([, e]) => !e.device))

/**
 * The releases the wire's vault published since the reader's last visit, newest first (data/releases.json, the
 * contract in the brief). On a first visit, or when none is newer, the latest one alone, so there is always the
 * last word from the desk to show. Pure: for the page and for the tests.
 */
export function releasesSince(file, prev) {
    const all = ((file && Array.isArray(file.releases)) ? file.releases : []).filter(r => r && r.at).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))
    if (!all.length) return []
    const newer = prev ? all.filter(r => String(r.at) > String(prev)) : []
    return newer.length ? newer : all.slice(0, 1)
}
