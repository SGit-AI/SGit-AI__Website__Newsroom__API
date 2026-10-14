/**
 * notes.js: the reader's feedback, as records.
 *
 * A note is one tap at a piece (read later, not for me, more like this, liked, wrong, fix this, idea), with words if
 * the reader adds them and the phrase they had selected if any. It is kept in this browser's local storage the moment
 * it is made, like everything the meter keeps; it goes into the reader vault when they press Update the vault
 * (assets/vault-pane/sync.js carries it in the device's file); and it goes to the newsroom only when they press Send,
 * into a lane of its own (assets/newsroom-vault.js, createLane and sendToLane). Nothing here touches the network.
 *
 * The record: { id, at, kind, path, title, n, story, text, quote, persona, sent? , device? }
 *   kind     one of KINDS, or "note" when there are words alone
 *   path     the page, as the meter records it (location.pathname)
 *   n        the article's number when the page is an article (articles/ids.json), else null
 *   story    a wire story's id when the note is about one, else null
 *   quote    what was selected on the page when the note was made, up to 600 characters
 *   persona  the meter's active persona at the time
 *   sent     { at, lane } once it has gone to the lane; set only on this device's own notes
 *   device   set on notes brought in from another device, never on this device's own
 *
 * The design: admin/notes/2026-10-12__the-feedback-loop.md.
 *
 * @module notes
 */

export const STORE = 'sgit.notes.v1'
export const FORMAT = 1
export const EVENT = 'sgit-notes'
export const KINDS = [
    { id: 'done', label: 'Done', about: 'piece', says: 'read it, done with it: hide it from my lists' },
    { id: 'read-later', label: 'Read later', about: 'piece', says: 'come back to this' },
    { id: 'follow-up', label: 'Follow up', about: 'piece', says: 'act on this, or write about it' },
    { id: 'not-for-me', label: 'Not for me', about: 'piece', says: 'this did not need to reach me' },
    { id: 'more-like-this', label: 'More like this', about: 'piece', says: 'more of this, please' },
    { id: 'liked', label: 'Liked', about: 'any', says: 'keep this as it is' },
    { id: 'wrong', label: 'Wrong', about: 'any', says: 'something here is not right' },
    { id: 'fix', label: 'Fix this', about: 'any', says: 'something here is broken or rough' },
    { id: 'idea', label: 'Idea', about: 'any', says: 'do this next' },
]
/** The kinds that are a decision about the piece itself: one of these at a page is its state in the lists. */
export const DECISIONS = ['done', 'read-later', 'follow-up', 'not-for-me', 'more-like-this']
export const kindLabel = id => (KINDS.find(k => k.id === id) || {}).label || (id === 'note' ? 'Message' : String(id || ''))
export const QUOTE_MAX = 600, TEXT_MAX = 2000

const hex8 = () => { const b = crypto.getRandomValues(new Uint8Array(4)); return [...b].map(x => x.toString(16).padStart(2, '0')).join('') }
const emit = detail => { try { window.dispatchEvent(new CustomEvent(EVENT, { detail })) } catch (e) { /* no window */ } }

// ------------------------------------------------------------ the store
export function read() {
    try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && Array.isArray(s.notes)) return s } catch (e) { /* fall through */ }
    return { v: FORMAT, notes: [] }
}
/** Writes the store; throws when the browser refuses (private mode, full). */
export function write(store) { localStorage.setItem(STORE, JSON.stringify({ v: FORMAT, notes: store.notes || [] })) }

// ------------------------------------------------------------ what the page says about itself
/** The meter's config block, for the storage key the persona is in. */
function meterCfg() {
    try { const el = document.getElementById('sg-meter-config'); if (el) { const c = JSON.parse(el.textContent); return { storageKey: c.storageKey || 'sgit.meter.v1' } } } catch (e) { /* defaults */ }
    return { storageKey: 'sgit.meter.v1' }
}
/** The meter's active persona: its id, and its name when it has one. */
export function persona() {
    try {
        const s = JSON.parse(localStorage.getItem(meterCfg().storageKey) || 'null')
        if (!s) return { id: 'me', name: '' }
        const p = (s.personas || []).find(x => x.id === s.active)
        return { id: s.active || 'me', name: (p && p.name) || '' }
    } catch (e) { return { id: 'me', name: '' } }
}
/** The page: its path as the meter records it, its title, and its article number when it has one. */
export function pageInfo() {
    let n = null
    for (const p of document.querySelectorAll('p.small')) { const m = /Article No\. (\d+)/.exec(p.textContent || ''); if (m) { n = Number(m[1]); break } }
    const h1 = document.querySelector('main h1, h1')
    return { path: location.pathname, title: ((h1 && h1.textContent) || document.title || '').trim().slice(0, 200), n }
}
/** What the reader has selected on the page, trimmed, for the record. */
export function selection() {
    try { return String(window.getSelection ? window.getSelection() : '').replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX) } catch (e) { return '' }
}

// ------------------------------------------------------------ the actions
/**
 * Keep one note. `kind` is one of KINDS or empty; with no kind and no words nothing is kept (returns null).
 * path, title, n and story default to the page's own; quote defaults to the selection.
 */
export function keep({ kind = '', text = '', quote, path, title, n, story = null } = {}) {
    const words = String(text || '').trim().slice(0, TEXT_MAX)
    if (!kind && !words) return null
    const page = pageInfo()
    const rec = {
        id: 'n-' + hex8(), at: new Date().toISOString(), kind: kind || 'note',
        path: path || page.path, title: (title == null ? page.title : String(title)).slice(0, 200), n: n === undefined ? page.n : n, story: story || null,
        text: words, quote: (quote === undefined ? selection() : String(quote || '')).slice(0, QUOTE_MAX), persona: persona().id,
    }
    const store = read()
    store.notes.unshift(rec)
    write(store)
    emit({ what: 'kept', id: rec.id, note: rec })
    return rec
}
/** Words added to a note already kept (the tap first, the words after). */
export function addWords(id, text) {
    const store = read(), rec = store.notes.find(x => x.id === id)
    if (!rec) return null
    rec.text = String(text || '').trim().slice(0, TEXT_MAX)
    rec.edited = new Date().toISOString()
    write(store); emit({ what: 'words', id })
    return rec
}
export function remove(id) {
    const store = read(), before = store.notes.length
    store.notes = store.notes.filter(x => x.id !== id)
    if (store.notes.length !== before) { write(store); emit({ what: 'removed', id }) }
    return before !== store.notes.length
}
/** Mark this device's own notes as sent to a lane. */
export function markSent(ids, lane) {
    const store = read(), at = new Date().toISOString(), set = new Set(ids)
    for (const rec of store.notes) if (set.has(rec.id) && !rec.device) rec.sent = { at, lane }
    write(store); emit({ what: 'sent', ids: [...set] })
}

// ------------------------------------------------------------ the views
export const list = () => read().notes.slice()
export const own = () => read().notes.filter(x => !x.device)
export const unsent = () => read().notes.filter(x => !x.device && !x.sent)
export const forPage = path => read().notes.filter(x => x.path === (path || location.pathname))
export const forStory = (path, story) => read().notes.filter(x => x.path === path && x.story === story)
/** The latest decision at a page itself (not at a story on it): done, read later, not for me, more like this; or null. */
export const decisionFor = path => read().notes.find(x => x.path === path && !x.story && DECISIONS.includes(x.kind)) || null
export const isDone = path => { const d = decisionFor(path); return !!d && d.kind === 'done' }
/** One note in words: "Wrong on The site is an inbox (No. 82): “…”, words". */
export function describeNote(rec) {
    const where = rec.story ? `story ${rec.story}` : (rec.title || rec.path) + (rec.n ? ` (No. ${rec.n})` : '')
    return `${kindLabel(rec.kind)} on ${where}${rec.quote ? `: “${rec.quote.length > 80 ? rec.quote.slice(0, 80) + '…' : rec.quote}”` : ''}${rec.text ? ` — ${rec.text}` : ''}`
}
