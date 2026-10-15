/**
 * wire-state.js: what this browser knows about the wires, kept locally like every other record.
 *
 *   seen     story id -> { at, device? }: when this reader first saw the story drawn, in this browser or (tagged with
 *            the device) on another of their devices, brought in through the vault
 *   visits   when the last visit to each wire started, so the page can say what arrived since; a visit lasts for the tab
 *   lens     the persona the reader chose to read each wire as, remembered between visits
 *
 * A story is NEW when it was first seen during this visit: it had not been drawn for this reader before, on this
 * device or on any device whose activity was brought in. Reloading the page keeps the visit, so a reload does not
 * clear what is new; a new tab or a new day starts a new visit.
 *
 * There is more than one wire (the Industry Wire at /wire/, and the wires under it, each read from its own vault), and
 * their story ids can collide (ai-01 is a story in more than one vault), so every record takes a scope: '' for the
 * Industry Wire, the wire's slug for the others. A seen id is stored as `scope:id` when scoped; the visit and the lens
 * of a scoped wire are kept beside the Industry Wire's, never over them. The device file carries the seen ids as
 * stored, scope and all, so another device tells them apart too.
 *
 * Like the notes, this is kept in local storage as it happens and carried to the reader vault only when the reader
 * presses Update the vault (assets/vault-pane/sync.js). The design: admin/notes/2026-10-13__the-wire-as-an-inbox.md.
 *
 * @module wire-state
 */

export const STORE = 'sgit.wire.v1', SESSION = 'sgit.wire.visit', FORMAT = 1, EVENT = 'sgit-wire'
const emit = detail => { try { window.dispatchEvent(new CustomEvent(EVENT, { detail })) } catch (e) { /* no window */ } }
/** The stored key of a story id under a scope: the id itself for the Industry Wire, `scope:id` for another wire. */
export const key = (id, scope = '') => scope ? `${scope}:${id}` : String(id)
const sessionKey = scope => scope ? `${SESSION}:${scope}` : SESSION

export function read() {
    try {
        const s = JSON.parse(localStorage.getItem(STORE) || 'null')
        if (s && typeof s.seen === 'object' && s.seen) return { v: FORMAT, seen: s.seen, last_visit: s.last_visit || null, lens: s.lens || '', visits: (s.visits && typeof s.visits === 'object') ? s.visits : {}, lenses: (s.lenses && typeof s.lenses === 'object') ? s.lenses : {} }
    } catch (e) { /* fall through */ }
    return { v: FORMAT, seen: {}, last_visit: null, lens: '', visits: {}, lenses: {} }
}
export function write(s) { localStorage.setItem(STORE, JSON.stringify({ v: FORMAT, seen: s.seen || {}, last_visit: s.last_visit || null, lens: s.lens || '', visits: s.visits || {}, lenses: s.lenses || {} })) }

/** This visit to a wire: { start, prev }. The first call in a tab starts a visit and moves the wire's last visit; later calls in the tab return the same. */
export function visit(scope = '', now = new Date().toISOString()) {
    try { const v = JSON.parse(sessionStorage.getItem(sessionKey(scope)) || 'null'); if (v && v.start) return v } catch (e) { /* new visit */ }
    const s = read()
    const v = { start: now, prev: (scope ? s.visits[scope] : s.last_visit) || null }
    if (scope) s.visits[scope] = now; else s.last_visit = now
    try { write(s) } catch (e) { /* no storage: the visit lives in memory */ }
    try { sessionStorage.setItem(sessionKey(scope), JSON.stringify(v)) } catch (e) { /* fine */ }
    return v
}

/** Record the stories drawn for this reader on a wire; returns the ids seen for the first time. */
export function markSeen(ids, scope = '', now = new Date().toISOString()) {
    const s = read(), added = []
    for (const id of ids) if (id && !s.seen[key(id, scope)]) { s.seen[key(id, scope)] = { at: now }; added.push(id) }
    if (added.length) { try { write(s); emit({ what: 'seen', ids: added, scope }) } catch (e) { /* fine */ } }
    return added
}

/** New in this visit: first seen at or after the visit started, here (never brought in from another device). */
export function isNew(id, v, scope = '', s = read()) { const e = s.seen[key(id, scope)]; return !!e && !e.device && !!v && String(e.at) >= String(v.start) }

export const lens = (scope = '') => (scope ? read().lenses[scope] : read().lens) || ''
export function setLens(id, scope = '') { const s = read(); if (scope) s.lenses[scope] = id || ''; else s.lens = id || ''; try { write(s) } catch (e) { /* fine */ } }

/** This device's own seen entries, for its file in the reader vault, keyed as stored (scope and all). */
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
