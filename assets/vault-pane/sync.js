/**
 * sync.js: the reading account's data between a browser's local storage and the reader vault, as pure functions.
 *
 * The design (admin/notes/2026-10-12__the-activity-vault.md):
 *   - local storage stays the primary store, updated as the reader reads; the vault is updated when the reader asks;
 *   - the vault holds RAW records, never totals: each device writes one file with everything it originated
 *     (reads with their depth, rating and decline; top-ups; personas), rewritten whole on every sync, so a
 *     device only ever overwrites its own file and two devices cannot conflict;
 *   - a consolidated view is computed from all the device files each time it is needed, and the totals
 *     (reads, spent, declined, credit, balance) are recomputed from the records with one starting credit
 *     for the account, never copied from a device;
 *   - bringing other devices' records into a browser adds them to its local state tagged with the device they
 *     came from, so the next sync from that browser writes only its own records back.
 *
 * Nothing here touches storage or the network: the pane (vault-pane.js) reads and writes, this file decides.
 * The meter's state (sg-meter-core.js, v1.4.0): { v, created, balance, spent, reads, declined, log[], topups[],
 * sessions[], active, personas[], shares[] }; a log entry: { id, at, path, title, kind, topics, price, depth,
 * cost, persona, autoKept?, rating?, declined? }. The notes store (notes.js, kept apart from the meter's state):
 * { v, notes[] }; a note: { id, at, kind, path, title, n, story, text, quote, persona, sent?, device? }. A device's
 * file carries its own notes beside its reads, and a merge brings other devices' notes in the same way.
 *
 * @module vault-sync
 */

export const FORMAT = 1
export const PATHS = {
    account: '/activity/account.json',
    devicesFolder: '/activity/devices',
    device: id => `/activity/devices/${id}.json`,
}
const r1 = x => Math.round(x * 10) / 10
const topupKey = t => (t.ref && t.ref !== 'undefined' && t.source === 'link') ? `ref:${t.ref}` : `at:${t.at}|${t.credit}|${t.device || ''}`

/** The account file, written once by the device that creates the account: the one starting credit. */
export function accountFile(cfg, deviceId) {
    return { v: FORMAT, start: Number(cfg.start) || 0, symbol: cfg.symbol || '£', created: new Date().toISOString(), created_by: deviceId }
}

/**
 * This device's file: the records it originated, whole. `prev` is the file as last written (for first_sync and
 * the sync count); records merged in from other devices (tagged with their device) are left out. `extra.notes` is
 * the notes store (assets/vault-pane/notes.js), kept apart from the meter's state so the meter's own writes never
 * touch it; its own notes travel in the same file.
 */
export function extract(state, device, prev = null, extra = {}) {
    const own = e => !e.device || e.device === device.id
    const now = new Date().toISOString()
    return {
        v: FORMAT,
        device: { id: device.id, label: device.label || '', agent: device.agent || '', first_sync: (prev && prev.device && prev.device.first_sync) || now, last_sync: now, syncs: ((prev && prev.device && prev.device.syncs) || 0) + 1 },
        created: state.created || null,
        reads: (state.log || []).filter(own).map(e => ({ ...e, device: device.id })),
        topups: (state.topups || []).filter(own).map(t => ({ ...t, device: device.id })),
        personas: (state.personas || []).filter(p => own(p)).map(p => ({ ...p, device: p.device || device.id })),
        notes: ((extra && extra.notes) || []).filter(own).map(n => ({ ...n, device: device.id })),
        wire: { seen: Object.fromEntries(Object.entries(((extra && extra.wire) || {})).filter(([, e]) => e && !e.device).map(([id, e]) => [id, { at: e.at }])) },
        active: state.active || 'me',
    }
}

/** The best version of one read seen in several places: the one that knows most. Only its own device changes a read. */
function newer(a, b) {
    if (!a) return b
    if (!b) return a
    const score = e => (e.declined ? 4 : 0) + (e.rating ? 2 : 0) + (e.depth || 0)
    return score(b) > score(a) ? b : a
}

/** Of two versions of one note, the one that knows more: sent beats unsent, then the one with words. */
function newerNote(a, b) {
    if (!a) return b
    if (!b) return a
    const score = n => (n.sent ? 2 : 0) + (n.text ? 1 : 0)
    return score(b) > score(a) ? b : a
}

/** Every device's file into one view, with the totals recomputed from the records. */
export function consolidate(files, account) {
    const start = account && Number.isFinite(Number(account.start)) ? Number(account.start) : 0
    const reads = new Map(), topups = new Map(), personas = new Map(), notes = new Map(), seen = {}, devices = []
    for (const f of (files || []).filter(Boolean).sort((a, b) => String((a.device || {}).last_sync || '').localeCompare(String((b.device || {}).last_sync || '')))) {
        const d = f.device || {}
        let spent = 0, declined = 0, credit = 0
        for (const e of f.reads || []) { reads.set(e.id, newer(reads.get(e.id), e)); spent += e.cost || 0; declined += e.declined ? (e.declined.refunded || 0) : 0 }
        for (const t of f.topups || []) { topups.set(topupKey(t), t); credit += t.credit || 0 }
        for (const p of f.personas || []) { if (p.id === 'me' && personas.has('me')) { const m = personas.get('me'); personas.set('me', { ...m, on: [...new Set([...(m.on || []), ...(p.on || [])])], off: [...new Set([...(m.off || []), ...(p.off || [])])], name: m.name || p.name }) } else personas.set(p.id, p) }
        for (const n of f.notes || []) notes.set(n.id, newerNote(notes.get(n.id), n))
        for (const [id, e] of Object.entries((f.wire && f.wire.seen) || {})) { if (e && e.at && (!seen[id] || String(e.at) < String(seen[id].at))) seen[id] = { at: e.at, device: d.id } }   // first seen anywhere
        devices.push({ id: d.id, label: d.label || '', agent: d.agent || '', first_sync: d.first_sync, last_sync: d.last_sync, syncs: d.syncs || 0,
                       reads: (f.reads || []).length, spent: r1(spent), declined: r1(declined), topups: (f.topups || []).length, credit: r1(credit), personas: (f.personas || []).length,
                       notes: (f.notes || []).length, sent: (f.notes || []).filter(n => n.sent).length })
    }
    const allReads = [...reads.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const allTopups = [...topups.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const allNotes = [...notes.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const spent = r1(allReads.reduce((s, e) => s + (e.cost || 0), 0))
    const declined = r1(allReads.reduce((s, e) => s + (e.declined ? (e.declined.refunded || 0) : 0), 0))
    const credit = r1(allTopups.reduce((s, t) => s + (t.credit || 0), 0))
    return {
        v: FORMAT, start, devices, reads: allReads, topups: allTopups, personas: [...personas.values()], notes: allNotes, wire: { seen },
        totals: { reads: allReads.length, spent, declined, credit, balance: r1(start + credit - spent), devices: devices.length, notes: allNotes.length, sent: allNotes.filter(n => n.sent).length, seen: Object.keys(seen).length },
    }
}

/**
 * Two files of the same device into one (card 049): the file already in the vault and one that browser sent through
 * the inbox, or two sends. Every record of either is kept, the one that knows more where both have it; the device
 * header is the newer file's, with the earlier first sync and the larger sync count. Neither file is changed.
 */
export function combine(prev, next) {
    if (!prev) return next
    if (!next) return prev
    const [older, newer_] = String((prev.device || {}).last_sync || '') <= String((next.device || {}).last_sync || '') ? [prev, next] : [next, prev]
    const byId = (a, b, pick) => { const m = new Map(); for (const x of [...(a || []), ...(b || [])]) m.set(x.id, pick(m.get(x.id), x)); return [...m.values()].sort((x, y) => String(y.at).localeCompare(String(x.at))) }
    const topups = new Map(); for (const t of [...(older.topups || []), ...(newer_.topups || [])]) topups.set(topupKey(t), t)
    const personas = new Map(); for (const p of [...(older.personas || []), ...(newer_.personas || [])]) personas.set(p.id, { ...(personas.get(p.id) || {}), ...p })
    const seen = { ...((older.wire && older.wire.seen) || {}) }
    for (const [id, e] of Object.entries((newer_.wire && newer_.wire.seen) || {})) if (!seen[id] || String(e.at) < String(seen[id].at)) seen[id] = e
    const d0 = older.device || {}, d1 = newer_.device || {}
    return {
        ...newer_,
        device: { ...d1, first_sync: [d0.first_sync, d1.first_sync].filter(Boolean).sort()[0] || d1.first_sync, syncs: Math.max(d0.syncs || 0, d1.syncs || 0) },
        created: older.created || newer_.created || null,
        reads: byId(older.reads, newer_.reads, newer), topups: [...topups.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))),
        personas: [...personas.values()], notes: byId(older.notes, newer_.notes, newerNote), wire: { seen },
    }
}

/**
 * What other devices saw on the wire, into this browser's wire state: stories it has not seen, tagged with the
 * device that saw them first, so they are not new here and the next update from here does not claim them.
 * Returns { store, added }.
 */
export function mergeWire(store, consolidated, deviceId) {
    const s = { ...(store || {}), seen: { ...((store && store.seen) || {}) } }
    let added = 0
    for (const [id, e] of Object.entries((consolidated.wire && consolidated.wire.seen) || {})) {
        if (s.seen[id] || e.device === deviceId) continue
        s.seen[id] = { at: e.at, device: e.device }; added++
    }
    return { store: s, added }
}

/**
 * Other devices' notes into this browser's notes store: the ones it does not have, tagged with their device.
 * This device's own notes are never changed by a merge. Returns { store, added }.
 */
export function mergeNotes(store, consolidated, deviceId) {
    const s = { v: (store && store.v) || FORMAT, notes: [...((store && store.notes) || [])] }
    const have = new Set(s.notes.map(n => n.id))
    let added = 0
    for (const n of consolidated.notes || []) {
        if (have.has(n.id) || n.device === deviceId) continue
        s.notes.push({ ...n }); have.add(n.id); added++
    }
    s.notes.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return { store: s, added }
}

/**
 * Other devices' records into this browser's state: reads and top-ups it does not have, tagged with their device;
 * personas it does not have; the totals recomputed from the merged records with the account's starting credit.
 * The local state's own records are never changed. Returns { state, added }.
 */
export function mergeInto(state, consolidated, deviceId) {
    const s = { ...state, log: [...(state.log || [])], topups: [...(state.topups || [])], sessions: [...(state.sessions || [])], personas: [...(state.personas || [])] }
    const added = { reads: 0, topups: 0, personas: 0 }
    const have = new Set(s.log.map(e => e.id))
    for (const e of consolidated.reads || []) {
        if (have.has(e.id)) continue
        if (e.device === deviceId) continue                      // this device's own record, missing locally: the local copy is the truth here
        s.log.push({ ...e }); have.add(e.id); added.reads++
    }
    s.log.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const haveT = new Set(s.topups.map(topupKey))
    for (const t of consolidated.topups || []) {
        if (haveT.has(topupKey(t)) || t.device === deviceId) continue
        s.topups.push({ ...t }); haveT.add(topupKey(t)); added.topups++
        if (t.source === 'link' && t.ref && !s.sessions.includes(t.ref)) s.sessions.push(t.ref)
    }
    s.topups.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const haveP = new Set(s.personas.map(p => p.id))
    for (const p of consolidated.personas || []) {
        if (haveP.has(p.id)) continue
        s.personas.push({ ...p }); haveP.add(p.id); added.personas++
    }
    const start = Number.isFinite(Number(consolidated.start)) ? Number(consolidated.start) : 0
    s.spent = r1(s.log.reduce((a, e) => a + (e.cost || 0), 0))
    s.declined = r1(s.log.reduce((a, e) => a + (e.declined ? (e.declined.refunded || 0) : 0), 0))
    s.reads = s.log.length
    s.balance = r1(start + s.topups.reduce((a, t) => a + (t.credit || 0), 0) - s.spent)
    return { state: s, added }
}

/** What a sync would write, in words, for the pane and the tests. */
export function describe(file) {
    const seen = Object.keys((file.wire && file.wire.seen) || {}).length
    return `${file.reads.length} read(s), ${file.topups.length} top-up(s), ${file.personas.length} persona(s), ${(file.notes || []).length} note(s)${seen ? `, ${seen} wire stories seen` : ''} from ${file.device.label || file.device.id}`
}
