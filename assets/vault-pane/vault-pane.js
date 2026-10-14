/**
 * vault-pane.js: the reader's vault, as a pane on the right of every page, in three tabs.
 *
 *   This page   feedback, one tap at a time (assets/vault-pane/notes.js): read later, not for me, more like this,
 *               liked, wrong, fix this, idea, with words and the phrase selected on the page; kept in this browser
 *               as it happens; every note kept, on this page and in all; Send to the newsroom, which carries the
 *               notes not yet sent into a lane of their own and shows the lane's read key to hand over.
 *   Vault       enable the account on this device: the passkey's PRF bytes derive the door (assets/door.js); the
 *               door opens the master, the master opens the reader vault and gives the access key
 *               (assets/newsroom-vault.js). No door at the address means "no door here for this path yet": create
 *               an account (an access key, pasted once, kept in the master), or type the recovery code to add this
 *               path as a door. Update the vault: this device's records (reads, top-ups, personas, notes) written as
 *               one file in the reader vault, one commit, published, only when the reader asks. Across your devices:
 *               every device's file read, consolidated, totals recomputed (assets/vault-pane/sync.js); "Bring their
 *               activity here" adds other devices' records and notes to this browser and reloads.
 *   Keys        every vault of the account with its key, to open any of them on your own; the lane's read key.
 *
 * The inbox (card 049, assets/vault-pane/inbox.js): in the Vault tab, a link that lets a browser without the passkey
 * send what it holds into this account, as a URL, as text and as a QR code; what is waiting in the lane, opened with
 * the private key from the master and shown before it is brought in; and a new link that stops the old one. A browser
 * that holds a link and no passkey gets Send to my vault in the strip above the tabs (assets/vault-pane/send.js).
 *
 * Above the tabs, and as a count on the Vault button: what this browser holds that the vault does not yet
 * (assets/vault-pane/pending.js), with Update the vault one press away. Local storage is where everything is kept
 * first; until the reader updates, it exists in this browser alone. Other pages ask for the pane and for an update
 * with two window events, sgit-vault-open {tab} and sgit-vault-update; the pane answers with sgit-vault-updated.
 *
 * Every call to the vault server is listed as it happens, under the tabs.
 *
 * Where the keys live: in memory, and for the life of this tab in sessionStorage (so a page change does not ask
 * for the passkey again). Nothing is written to localStorage but this device's id and label, and the notes. The
 * vault library (assets/vendor/sg-vault, twelve pinned files and one local extension) is loaded from this origin
 * the first time it is needed, not on every page. The design: admin/notes/2026-10-12__the-activity-vault.md and
 * admin/notes/2026-10-12__the-feedback-loop.md.
 *
 * @module vault-pane
 */
import * as NV from '../newsroom-vault.js'
import { doorFrom, prfBytes, recoveryBytes, recoveryCode, PRF_INPUT_TEXT, sha256 } from '../door.js'
import { extract, consolidate, combine, mergeInto, mergeNotes, mergeWire, accountFile, PATHS, describe } from './sync.js'
import * as N from './notes.js'
import * as R from './reading.js'
import * as W from './wire-state.js'
import { pending, describePending } from './pending.js'
import * as I from './inbox.js'
import * as SND from './send.js'

const ROOT = new URL(document.documentElement.getAttribute('data-root') || '', document.baseURI)   // the page's site root: every page carries data-root; the code is served from api.newsroom.sgit.ai
const CODE = new URL('../../', import.meta.url)                       // assets/vault-pane/ → where this code is served from
const ENDPOINT = 'https://dev.send.sgraph.ai'
const LIB = ['sg-send/sg-send-crypto.js', 'sg-send/sg-send.js', 'sg-vault/sg-vault-crypto.js', 'sg-vault/sg-vault-object-store.js', 'sg-vault/sg-vault-ref-manager.js',
             'sg-vault/sg-vault-commit.js', 'sg-vault/sg-vault.js', 'sg-vault/sg-vault--file-ops.js', 'sg-vault/sg-vault--folder-ops.js', 'sg-vault/sg-vault--sync.js',
             'sg-vault/sg-vault--history.js', 'sg-vault/sg-vault--branches.js'].map(f => `assets/vendor/sg-vault/v0.2.3/${f}`).concat(['assets/vendor/sg-vault/local/sg-vault--create-with-id.js'])
const SESSION = 'sgit.vault.session', LABEL = 'sgit.device-label', OPEN = 'sgit.vault.open', LAST_SYNC = 'sgit.vault.last-sync'
const TOKEN_FILE = { folder: '/.vault', name: 'access-token.json' }    // where the library's readEmbeddedAccessToken() looks
const TABS = [['page', 'This page'], ['reading', 'Reading'], ['vault', 'Vault'], ['keys', 'Keys']]

const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v) }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}
const row = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v))
const err = e => (e && e.name && e.name !== 'Error' ? `${e.name}: ` : '') + String(e && e.message || e)
const money = (p, sym) => `${p < -0.004 ? '−' : ''}${sym || '£'}${(Math.abs(p) / 100).toFixed(2)}`
const shorten = (s, n) => { s = String(s || ''); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…' }
const copyBtn = text => { const b = h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Copied' } catch (e) { b.textContent = 'Could not copy' } setTimeout(() => { b.textContent = 'Copy' }, 1500) } }, 'Copy'); return b }
const secret = (text, label) => {
    const span = h('span', { class: 'mono' }, `•••••••••••• (${text.length} characters)`)
    let shown = false
    const btn = h('button', { type: 'button', class: 'btn', onclick: () => { shown = !shown; span.textContent = shown ? text : `•••••••••••• (${text.length} characters)`; btn.textContent = shown ? 'Hide' : `Reveal ${label}` } }, `Reveal ${label}`)
    return h('span', { class: 'secret' }, span, btn, copyBtn(text))
}

// ------------------------------------------------------------ the meter's config and state, read as the meter reads them
function meterCfg() {
    let cfg = {}
    try { const el = document.getElementById('sg-meter-config'); if (el) cfg = JSON.parse(el.textContent) } catch (e) { cfg = {} }
    return { storageKey: cfg.storageKey || 'sg.meter.v1', start: cfg.start == null ? 500 : cfg.start, symbol: cfg.symbol || '£' }
}
const readState = key => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null } }
const emptyState = cfg => ({ v: 3, created: new Date().toISOString(), balance: cfg.start, spent: 0, reads: 0, declined: 0, paused: false, log: [], topups: [], cart: [], sessions: [], active: 'me', personas: [{ id: 'me', name: '', created: new Date().toISOString(), on: [], off: [] }] })

// ------------------------------------------------------------ the session: keys for the life of this tab
const session = {
    get() { try { return JSON.parse(sessionStorage.getItem(SESSION) || 'null') } catch (e) { return null } },
    set(v) { try { if (v) sessionStorage.setItem(SESSION, JSON.stringify(v)); else sessionStorage.removeItem(SESSION) } catch (e) { /* no storage: memory only */ } },
}
let libLoading = null
function loadLibrary() {
    if (typeof SGVault !== 'undefined' && typeof SGVault.createWithId === 'function') return Promise.resolve()
    if (libLoading) return libLoading
    libLoading = (async () => {
        for (const f of LIB) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL(f, CODE).href; s.onload = res; s.onerror = () => rej(new Error(`could not load ${f}`)); document.head.append(s) })
    })()
    return libLoading
}

// ------------------------------------------------------------ the pane
export function mount() {
    if (document.getElementById('sgit-vault-pane')) return
    const cfg = meterCfg()
    const deviceId = NV.deviceBranch()
    let label = ''; try { label = localStorage.getItem(LABEL) || '' } catch (e) { /* fine */ }
    const state = { drawn: false, vaults: null, lane: null, inbox: undefined, waiting: [], consolidated: null, busy: false, sg: null, tab: 'page', sel: '', lastKept: null }
    const tabs = h('div', { class: 'tabs', role: 'tablist' })
    const secs = Object.fromEntries(TABS.map(([id]) => [id, h('section', { id: `vault-sec-${id}`, role: 'tabpanel', hidden: true })]))
    const body = secs.vault
    const fill = (...kids) => body.replaceChildren(...kids.flat().filter(k => k != null && k !== false))   // replaceChildren would print a null as text
    const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false))
    const log = h('ul', { class: 'log', hidden: true })
    const pendingMsg = h('span', { class: 'msg', id: 'vault-pending-msg' }), pendingOut = h('span', { class: 'out', id: 'vault-pending-out' })
    const pendingBtn = h('button', { type: 'button', class: 'btn primary', id: 'vault-update-now', onclick: () => updateNow() }, 'Update the vault')
    const inboxBtn = h('button', { type: 'button', class: 'btn', id: 'vault-inbox-send', hidden: true, onclick: () => sendFromHere() }, 'Send to my vault')
    const pendingStrip = h('div', { class: 'pending', id: 'vault-pending', hidden: true }, pendingMsg, h('div', { class: 'acts' }, pendingBtn, inboxBtn), pendingOut)
    const pane = h('aside', { id: 'sgit-vault-pane', class: 'vault-pane', 'aria-label': 'Your vault' },
        h('div', { class: 'head' }, h('h2', {}, 'Your vault'), h('button', { type: 'button', class: 'btn close', onclick: () => toggle(false) }, 'Close')),
        h('p', { class: 'dim' }, 'Your notes on what you read, what you have read, and the reading account this browser keeps, carried between your devices through an encrypted vault that opens with your passkey. Local storage stays the place it lives; the vault is updated when you ask.'),
        pendingStrip, tabs, ...TABS.map(([id]) => secs[id]),
        h('h3', {}, 'Calls to the vault server'), log)
    document.body.append(pane)
    for (const [id, name] of TABS) tabs.append(h('button', { type: 'button', class: 'tab', id: `vault-tab-${id}`, role: 'tab', 'aria-selected': 'false', 'aria-controls': `vault-sec-${id}`, onclick: () => showTab(id) }, name, id === 'page' ? h('span', { class: 'n', id: 'vault-tab-page-n' }, String(N.list().length)) : null))
    const buttons = [...document.querySelectorAll('.vault-btn')]
    const remember = on => { try { if (on) sessionStorage.setItem(OPEN, state.tab); else sessionStorage.removeItem(OPEN) } catch (e) { /* fine */ } }
    const toggle = open => {
        const on = open == null ? !document.documentElement.classList.contains('vault-open') : open
        document.documentElement.classList.toggle('vault-open', on)
        for (const b of buttons) b.setAttribute('aria-expanded', String(on))
        if (on) { if (!state.drawn) draw(); showTab(state.tab) }
        remember(on)                                                          // open stays open from page to page, on the same tab
    }
    function showTab(id) {
        state.tab = TABS.some(([k]) => k === id) ? id : 'page'
        for (const [k] of TABS) { document.getElementById(`vault-tab-${k}`).setAttribute('aria-selected', String(k === state.tab)); secs[k].hidden = k !== state.tab }
        if (state.tab === 'page') drawPage()
        if (state.tab === 'reading') drawReading()
        if (state.tab === 'keys') drawKeys()
        if (document.documentElement.classList.contains('vault-open')) remember(true)
    }
    for (const b of buttons) b.addEventListener('click', () => toggle())

    const say = (line, cls) => { log.prepend(h('li', { class: cls || '' }, `${new Date().toISOString().slice(11, 19)} ${line}`)); log.hidden = false; while (log.children.length > 60) log.lastChild.remove() }
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
        const u = String(input instanceof Request ? input.url : input)
        if (!u.startsWith(ENDPOINT + '/')) return origFetch(input, init)
        const method = (init && init.method) || (input instanceof Request ? input.method : 'GET')
        const r = await origFetch(input, init)
        say(`${method} ${u.slice(ENDPOINT.length).replace(/\/obj-cas-imm-[0-9a-f]{12}/g, '/obj-cas-imm-…')} → ${r.status}`, r.ok || r.status === 404 ? '' : 'warn')
        return r
    }

    const setButtons = () => { for (const b of buttons) { b.classList.toggle('on', !!session.get()); const d = b.querySelector('.dot'); if (d) d.title = session.get() ? 'enabled on this device' : 'not enabled on this device' } }
    setButtons()

    /** What is only in this browser: the strip above the tabs and the count on the Vault button. */
    function renderPending() {
        const p = pending(), enabled = !!session.get()
        for (const b of buttons) {
            b.classList.toggle('pending', p.count > 0)
            let badge = b.querySelector('.pend'); if (!badge) { badge = h('span', { class: 'pend' }); b.append(badge) }
            badge.textContent = p.count ? String(p.count) : ''; badge.hidden = !p.count
            b.title = p.count ? `Your vault: ${p.count} change(s) only in this browser, not yet in your vault` : 'Your vault: the reading account carried between your devices'
        }
        pendingStrip.hidden = !p.any
        if (p.any) {
            pendingMsg.textContent = `${p.count ? `${p.count} change(s) only in this browser` : 'Only in this browser'}: ${describePending(p)}. ${p.last ? `Last update from here ${p.last.slice(0, 16).replace('T', ' ')}.` : 'This device has never updated the vault.'} Clearing the browser would lose ${p.count ? 'them' : 'it'} until you update.`
            pendingBtn.textContent = enabled ? 'Update the vault' : 'Enable the vault to keep them'
        }
        inboxBtn.hidden = enabled || !p.any || !SND.remembered()          // a browser that holds a link to the inbox: send without the passkey
        if (pageDrawn) renderSteps()
        return p
    }
    async function updateNow() {
        if (state.busy) return
        const rec = session.get()
        if (!rec) { toggle(true); showTab('vault'); return }
        pendingBtn.disabled = true; pendingOut.textContent = 'Updating the vault…'; state.busy = true
        try {
            if (!state.vaults) await openAll(rec)
            if (!state.vaults.token) { pendingOut.textContent = ''; toggle(true); showTab('vault'); throw new Error('the master holds no access key: add it once in the Vault tab') }
            if (!state.vaults.reader) throw new Error('the account has no reader vault')
            const file = await writeDevice()
            pendingOut.textContent = `Updated: ${describe(file)}.`
            try { window.dispatchEvent(new CustomEvent('sgit-vault-updated', { detail: { ok: true, file: describe(file) } })) } catch (e) { /* fine */ }
            if (state.tab === 'vault' && document.getElementById('vault-across')) refreshAcross()
        } catch (e) {
            pendingOut.textContent = `Not updated: ${err(e)}`
            try { window.dispatchEvent(new CustomEvent('sgit-vault-updated', { detail: { ok: false, error: err(e) } })) } catch (e2) { /* fine */ }
        } finally { state.busy = false; pendingBtn.disabled = false; renderPending() }
    }
    window.addEventListener('sgit-vault-open', e => { toggle(true); if (e.detail && e.detail.tab) showTab(e.detail.tab) })
    window.addEventListener('sgit-vault-update', () => updateNow())
    window.addEventListener(W.EVENT, () => renderPending())
    window.addEventListener(N.EVENT, () => renderPending())
    window.addEventListener(SND.EVENT, () => renderPending())
    async function sendFromHere() {
        const link = SND.remembered(); if (!link) return
        inboxBtn.disabled = true; pendingOut.textContent = 'Encrypting in this browser, then appending to your vault’s inbox…'
        try { const r = await SND.sendNow(link, { label }); pendingOut.textContent = `Sent to your vault’s inbox: ${describe(r.file)}. Your vault takes it in the next time you open it with your passkey; it stays here too.` }
        catch (e) { pendingOut.textContent = `Not sent: ${err(e)}. Nothing was lost.` }
        finally { inboxBtn.disabled = false; renderPending() }
    }
    setInterval(() => { if (document.visibilityState !== 'hidden') renderPending() }, 3000)   // the meter writes without an event

    async function client(token) { await loadLibrary(); if (!state.sg) state.sg = NV.client({ endpoint: ENDPOINT, token: token || '' }); if (token) state.sg.token = token; return state.sg }

    /** Open everything from a session record { door:{passphrase,vaultId}, path } : the door, the master (and its access key), the reader vault. */
    async function openAll(rec) {
        const sg = await client(rec.token || '')
        const u = await NV.unlock({ sgSend: sg, door: rec.door })
        let token = rec.token || ''
        if (!token) { try { const t = await NV.readJson(u.master, `${TOKEN_FILE.folder}/${TOKEN_FILE.name}`); token = t && t.token || '' } catch (e) { token = '' } }
        if (token) sg.token = token
        state.vaults = { ...u, token }
        state.lane = null                                                     // not looked for yet
        state.inbox = undefined; state.waiting = []
        session.set({ ...rec, token })
        setButtons()
        return state.vaults
    }
    /** The lane, opened from the master's record the first time it is asked for; null when the account has none. */
    async function ensureLane() {
        if (!state.vaults) return null
        if (state.lane === null) { try { state.lane = (await NV.openLane({ sgSend: await client(state.vaults.token), master: state.vaults.master })) || false } catch (e) { state.lane = false } }
        return state.lane || null
    }

    // ------------------------------------------------------------ this page: feedback, one tap at a time
    const selOut = h('p', { class: 'sel', id: 'note-sel', hidden: true })
    document.addEventListener('selectionchange', () => {
        try { const s = document.getSelection(); if (s && s.anchorNode && pane.contains(s.anchorNode)) return } catch (e) { /* fine */ }
        const t = N.selection()
        if (t) { state.sel = t; selOut.textContent = `Selected: “${shorten(t, 160)}”`; selOut.hidden = false }
    })
    const clearSel = () => { state.sel = ''; selOut.hidden = true; selOut.textContent = '' }
    let pageDrawn = false
    const lists = { here: h('ul', { class: 'notes', id: 'notes-here' }), all: h('ul', { class: 'notes', id: 'notes-all' }), counts: h('p', { class: 'dim', id: 'notes-count' }), lane: h('div', { id: 'vault-lane' }), sendOut: h('div', { id: 'vault-send-out' }),
                    known: h('div', { class: 'known', id: 'page-known' }), steps: h('ol', { class: 'steps', id: 'vault-steps' }) }
    const sendBtn = h('button', { type: 'button', class: 'btn primary', id: 'vault-send', onclick: send }, 'Send to the newsroom')
    const kept = h('p', { class: 'ok', id: 'note-kept', hidden: true })
    const words = h('textarea', { id: 'note-words', rows: 3, 'aria-label': 'A message to the newsroom', placeholder: 'To the newsroom: what is wrong, what to change, a question, an idea…' })
    const saved = h('p', { class: 'ok', id: 'note-saved', hidden: true })
    function drawPage() {
        if (!pageDrawn) {
            pageDrawn = true
            const page = N.pageInfo()
            const tap = kind => {
                const rec = N.keep({ kind, text: words.value, quote: state.sel || '' })
                if (!rec) return
                words.value = ''; clearSel(); state.lastKept = rec.id
                kept.textContent = `Kept: ${N.describeNote(rec)}.${rec.text ? '' : ' Anything you write to the newsroom next is added to it.'}`; kept.hidden = false; saved.hidden = true
            }
            // the message: words for the newsroom's agent, saved here as a note and carried with the rest by Send
            const keepWords = () => {
                const t = words.value.trim(); if (!t) { words.focus(); return null }
                const last = state.lastKept && N.list().find(x => x.id === state.lastKept)
                const rec = last && !last.text ? N.addWords(last.id, t) : N.keep({ text: t, quote: state.sel || '' })
                if (!rec) return null
                words.value = ''; clearSel(); state.lastKept = null; kept.hidden = true
                const un = N.unsent().length
                saved.textContent = `Saved: ${N.describeNote(rec)}. It reaches the newsroom when you send: ${un} note(s) waiting.`; saved.hidden = false
                return rec
            }
            const keepAndSend = async () => { if (!keepWords()) return; await send(); lists.sendOut.scrollIntoView({ block: 'nearest' }) }
            secs.page.replaceChildren(
                lists.steps,
                h('h3', {}, 'About this page'),
                h('p', { class: 'dim' }, page.title ? `${page.title}${page.n ? ` (No. ${page.n})` : ''}` : location.pathname),
                lists.known,
                selOut,
                h('p', { class: 'dim lead-in' }, 'One tap, about this page:'),
                h('div', { class: 'chips', role: 'group', 'aria-label': 'One tap' }, ...N.KINDS.map(k => h('button', { type: 'button', class: 'chip', id: `note-${k.id}`, title: k.says, onclick: () => tap(k.id) }, k.label))),
                kept,
                h('h3', { id: 'note-write' }, 'Write to the newsroom'),
                h('p', { class: 'dim' }, 'A message for the newsroom’s agent, about this page or anything else. It goes with the page’s address and whatever you have selected on it.'),
                words,
                h('div', { class: 'acts' },
                    h('button', { type: 'button', class: 'btn primary', id: 'note-send', onclick: keepAndSend }, 'Save and send'),
                    h('button', { type: 'button', class: 'btn', id: 'note-keep', onclick: keepWords }, 'Save, send later')),
                saved,
                h('p', { class: 'dim' }, 'Everything is kept in this browser first. ', h('em', {}, 'Done'), ' also takes the page off your reading list. ', h('em', {}, 'Update the vault'), ' carries your notes to your other devices; ', h('em', {}, 'Send to the newsroom'), ' carries the ones not yet sent into a lane of their own, which the newsroom reads with a key you hand over. ', h('a', { href: new URL('vault/index.html#feedback', ROOT).href }, 'How the loop works'), '.'),
                h('h3', {}, 'Kept on this page'), lists.here,
                h('h3', {}, 'All your notes'), lists.counts, h('div', { class: 'acts' }, sendBtn), lists.sendOut, lists.lane, lists.all,
            )
        }
        renderNotes()
        if (state.vaults) ensureLane().then(drawLane)
    }
    /** What this browser knows about the page: its reads from the meter, and the decision at it. */
    function renderKnown() {
        const s = R.summary(location.pathname), d = N.decisionFor(location.pathname)
        const when = at => String(at || '').slice(0, 16).replace('T', ' ')
        put(lists.known,
            d ? h('span', { class: 'decision' }, N.kindLabel(d.kind)) : null,
            d ? h('span', {}, `on ${when(d.at)}. `) : null,
            s ? h('span', {}, h('b', {}, s.count === 1 ? 'Read once' : `Read ${s.count} times`), `, last ${when(s.last)}: you ${R.depthWords(s.depth)}`, s.cost ? `, ${s.cost}p` : '', s.rating && s.rating.useful ? `, rated ${s.rating.useful} of 5` : '', s.declined ? ', declined' : '', '.')
              : h('span', { class: 'dim' }, 'Not read in this browser before now, by the meter’s records.'))
    }
    /** The three steps, with the next one in bold. */
    function renderSteps() {
        const enabled = !!session.get(), updated = (() => { try { return localStorage.getItem(LAST_SYNC) || '' } catch (e) { return '' } })(), sent = N.own().some(n => n.sent)
        const waiting = pending().any
        const steps = [
            ['Enable the vault with your passkey', enabled, () => showTab('vault')],
            [waiting && updated ? `Update the vault: ${waiting} change(s) since the last update` : 'Update the vault, so your notes and reads reach your other devices', !!updated && !waiting, enabled ? () => updateNow() : () => showTab('vault')],
            ['Send your notes to the newsroom', sent, null],
        ]
        let nextSeen = false
        put(lists.steps, ...steps.map(([text, done, go], i) => {
            const next = !done && !nextSeen; if (next) nextSeen = true
            return h('li', { class: done ? 'done' : next ? 'next' : '' }, h('span', { class: 'n' }, String(i + 1)), h('span', {}, text, done && i === 1 ? ` (last ${updated.slice(0, 16).replace('T', ' ')})` : ''), next && go ? h('button', { type: 'button', onclick: go }, i === 1 && enabled ? 'Update' : 'Go') : null)
        }))
    }
    /** The reading list: every page read here, newest first, with its decision; pages marked done are folded away. */
    let showDone = false
    function drawReading() {
        const hist = R.history()
        const done = hist.filter(p => N.isDone(p.path)), shown = showDone ? hist : hist.filter(p => !N.isDone(p.path))
        const when = at => String(at || '').slice(0, 16).replace('T', ' ')
        const toggleDone = h('input', { type: 'checkbox', id: 'reading-show-done' }); toggleDone.checked = showDone
        toggleDone.addEventListener('change', () => { showDone = toggleDone.checked; drawReading() })
        put(secs.reading,
            h('h3', {}, 'What you have read here'),
            h('p', { class: 'dim', id: 'reading-count' }, hist.length ? `${hist.length} page(s) read in this browser, ${done.length} marked done${done.length && !showDone ? ' and folded away' : ''}. The meter’s records, as kept; ` : 'Nothing read in this browser yet, by the meter’s records. ', 'Done at a page takes it off this list; Update the vault carries the list to your other devices.'),
            h('label', { class: 'filter' }, toggleDone, 'Show the pages marked done'),
            h('ul', { class: 'reading', id: 'reading-list' }, ...shown.map(p => {
                const d = N.decisionFor(p.path)
                return h('li', { class: N.isDone(p.path) ? 'done-page' : '', 'data-path': p.path },
                    h('a', { href: new URL(p.path.replace(/^\//, ''), ROOT).href }, p.title || p.path),
                    h('span', { class: 'meta' }, d ? h('span', { class: `badge ${d.kind}` }, N.kindLabel(d.kind)) : null, d ? ' · ' : '', `${when(p.last)} · you ${R.depthWords(p.depth)}${p.count > 1 ? `, ${p.count} times` : ''}${p.cost ? `, ${p.cost}p` : ''}`),
                    N.isDone(p.path) ? null : h('button', { type: 'button', class: 'mark', title: 'Read it, done with it: fold it away', onclick: () => N.keep({ kind: 'done', path: p.path, title: p.title, n: null, quote: '' }) }, 'Done'))
            }), shown.length ? null : h('li', { class: 'dim' }, done.length ? 'Everything read here is marked done.' : 'Nothing yet.')))
    }
    const item = rec => h('li', { class: 'note', 'data-id': rec.id, 'data-kind': rec.kind },
        rec.device ? null : h('button', { type: 'button', class: 'x', title: 'Remove this note from this browser', onclick: () => N.remove(rec.id) }, 'remove'),
        h('span', { class: 'kind' + (rec.sent ? ' sent' : '') }, N.kindLabel(rec.kind)),
        h('span', { class: 'where' }, rec.story ? `story ${rec.story} on ` : '', h('a', { href: new URL(rec.path.replace(/^\//, '') + (rec.story ? '#' + rec.story : ''), ROOT).href }, rec.title || rec.path), rec.n ? ` (No. ${rec.n})` : ''),
        rec.quote ? h('span', { class: 'quote' }, `“${shorten(rec.quote, 220)}”`) : null,
        rec.text ? h('span', { class: 'words' }, rec.text) : null,
        h('span', { class: 'meta' }, `${String(rec.at).slice(0, 16).replace('T', ' ')} · ${rec.persona || 'me'}${rec.device ? ' · from ' + rec.device : ''}${rec.sent ? ' · sent ' + String(rec.sent.at).slice(0, 10) : ''}`))
    function renderNotes() {
        const all = N.list(), here = N.forPage(location.pathname), own = N.own(), un = N.unsent()
        const badge = document.getElementById('vault-tab-page-n'); if (badge) badge.textContent = String(all.length)
        put(lists.here, here.length ? here.map(item) : h('li', { class: 'dim' }, 'Nothing on this page yet.'))
        put(lists.all, all.length ? all.slice(0, 40).map(item) : h('li', { class: 'dim' }, 'No notes in this browser yet.'), all.length > 40 ? h('li', { class: 'dim' }, `and ${all.length - 40} more, in local storage`) : null)
        lists.counts.textContent = `${all.length} note(s) in this browser, ${own.length} of this device, ${un.length} not yet sent.`
        sendBtn.disabled = !un.length
        renderKnown(); renderSteps()
    }
    window.addEventListener(N.EVENT, () => { if (pageDrawn) renderNotes(); if (state.tab === 'reading') drawReading() })
    function drawLane() {
        const L = state.lane
        put(lists.lane, L ? h('div', { class: 'lane' },
            row('The lane', h('span', { class: 'mono' }, L.lane.vaultId)),
            row('Its read key', h('span', {}, h('span', { class: 'mono', id: 'vault-lane-key' }, L.record.read), ' ', copyBtn(L.record.read))),
            h('p', { class: 'dim' }, 'Hand the read key to the newsroom once, in the open: it reads the lane and cannot write to it, and nothing else of yours is in it. The write key stays in your master vault. ', h('span', { class: 'mono' }, `sgit clone ${L.record.read}`), ' reads every note.')) : null)
    }
    async function send() {
        const un = N.unsent(); if (!un.length) return
        if (!state.vaults) { lists.sendOut.replaceChildren(h('p', { class: 'warn' }, 'Enable the vault first, in the Vault tab: the lane lives in your master vault, so the newsroom only ever gets what you send.')); return }
        if (!state.vaults.token) { lists.sendOut.replaceChildren(h('p', { class: 'warn' }, 'The master holds no access key, so nothing can be written yet: add it once in the Vault tab, and every device of yours gets it from there.')); return }
        await withBusy('vault-send', async () => {
            lists.sendOut.replaceChildren(h('p', { class: 'dim' }, `Sending ${un.length} note(s)…`))
            try {
                const sg = await client(state.vaults.token)
                let L = await ensureLane()
                if (!L) { lists.sendOut.firstChild.textContent = 'Making the lane: a vault of its own, its key kept in your master…'; L = await NV.createLane({ sgSend: sg, master: state.vaults.master, device: deviceId }); state.lane = L }
                try { await L.lane.pull() } catch (e) { /* nothing new, or local commits */ }
                const paths = await NV.sendToLane(L.lane, un, deviceId)
                N.markSent(un.map(x => x.id), L.lane.vaultId)
                let carried = ''
                if (state.vaults.reader) { try { await writeDevice(); carried = ' This device’s file in the reader vault is updated too, so your other devices see them as sent.' } catch (e) { carried = '' } }
                lists.sendOut.replaceChildren(h('p', { class: 'ok', id: 'vault-sent' }, `Sent: ${paths.length} note(s) to the lane ${L.lane.vaultId}, published.${carried}`))
                drawLane()
            } catch (e) { lists.sendOut.replaceChildren(h('p', { class: 'warn' }, `Not sent: ${err(e)}`)) }
        })
        renderNotes()                                                          // withBusy re-enabled the button; the count decides
    }

    // ------------------------------------------------------------ the keys: every vault of the account
    async function drawKeys() {
        const v = state.vaults
        if (!v) { secs.keys.replaceChildren(h('h3', {}, 'Your vaults'), h('p', { class: 'dim' }, 'Enable the vault, in the Vault tab, to see the vaults of your account and their keys.')); return }
        const rec = session.get() || {}
        const L = await ensureLane()
        const doorRows = (v.doors || []).map(d => row(`Door · ${d.kind || 'passkey'}${d.path ? ' · ' + d.path : ''}${d.device ? ' · ' + d.device : ''}`, h('span', {}, h('span', { class: 'mono' }, d.vault_id), ' ', d.vault_key ? secret(d.vault_key, 'the key') : '')))
        secs.keys.replaceChildren(
            h('h3', {}, 'Your vaults'),
            h('p', { class: 'dim' }, 'Every vault of this account, with its key, so you can open any of them on your own: ', h('span', { class: 'mono' }, 'sgit clone <key>'), ', or the key pasted into ', h('a', { href: 'https://dev.vault.sgraph.ai/', target: '_blank', rel: 'noopener' }, 'the vault app'), '. A key opens that vault to whoever holds it, and the master’s opens everything: treat them like the recovery code. The page shows a key only when you press Reveal, and keeps none of them.'),
            h('div', { class: 'vaults' },
                row('This door', h('span', {}, h('span', { class: 'mono' }, `${v.door.vaultId}${rec.path ? ' · ' + rec.path : ''}`), ' ', secret(NV.prefixedKey(v.door), 'the key'))),
                ...doorRows.filter(r => !r.textContent.includes(v.door.vaultId)),
                row('Master', h('span', {}, h('span', { class: 'mono' }, v.master.vaultId), ' ', secret(NV.prefixedKey(v.master), 'the key'))),
                v.reader ? row('Reader vault', h('span', {}, h('span', { class: 'mono' }, v.reader.vaultId), ' ', secret(NV.prefixedKey(v.reader), 'the key'))) : null,
                L ? row('The lane', h('span', {}, h('span', { class: 'mono' }, L.lane.vaultId), ' ', secret(L.record.lane, 'the key'))) : row('The lane', 'none yet: made the first time you send'),
                L ? row('Its read key', h('span', {}, h('span', { class: 'mono' }, L.record.read), ' ', copyBtn(L.record.read))) : null),
            h('p', { class: 'dim' }, 'The lane’s read key is the one thing to hand to the newsroom; it reads and cannot write. Everything else stays yours.'),
            await (async () => { if (state.inbox === undefined) { try { state.inbox = await NV.readInbox(v.master) } catch (e) { state.inbox = null } } return state.inbox ? h('div', { class: 'vaults' }, row('Your inbox', h('span', { class: 'mono', id: 'keys-inbox' }, `a lane on ${state.inbox.vault} · key ${state.inbox.fingerprint}`)), h('p', { class: 'dim' }, 'Its link is in the Vault tab; its private key and enum key stay in the master.')) : null })(),
        )
    }

    // ------------------------------------------------------------ the vault
    async function draw() {
        state.drawn = true
        const rec = session.get()
        if (!rec) return drawLocked()
        fill(h('p', { class: 'dim' }, 'Opening your vault…'))
        try { await openAll(rec); await drawUnlocked() }
        catch (e) { session.set(null); setButtons(); drawLocked(h('p', { class: 'warn' }, `The vault could not be opened from the saved session: ${err(e)}. Enable it again.`)) }
    }

    function drawLocked(note) {
        const device = h('input', { type: 'text', value: label, maxlength: 40, placeholder: 'this device, e.g. "my laptop"' })
        device.addEventListener('change', () => { label = device.value.trim(); try { localStorage.setItem(LABEL, label) } catch (e) { /* fine */ } })
        fill(
            note || null,
            h('h3', {}, 'On this device'),
            row('Device', h('span', { class: 'mono' }, deviceId)),
            h('label', {}, 'A label for it', device),
            h('div', { class: 'acts' },
                h('button', { type: 'button', class: 'btn primary', id: 'vault-enable', onclick: enable }, 'Enable with your passkey'),
                h('button', { type: 'button', class: 'btn', id: 'vault-recover', onclick: () => drawRecover() }, 'I have a recovery code')),
            h('p', { class: 'dim' }, 'Your passkey gives this page 32 bytes that derive the address and key of a small door vault; the door holds the key of your master vault; the master holds your reader vault and your access key. Nothing is stored to be found, and nothing leaves this browser but ciphertext. ', h('a', { href: new URL('vault/index.html', ROOT).href }, 'How it works'), '.'),
        )
    }

    async function withBusy(btnId, fn) {
        const b = btnId && document.getElementById(btnId); if (b) b.disabled = true
        state.busy = true
        try { return await fn() } finally { state.busy = false; if (b) b.disabled = false }
    }

    async function enable() {
        await withBusy('vault-enable', async () => {
            const status = h('p', { class: 'dim' }, 'Waiting for your passkey…')
            body.prepend(status)
            let prf
            try { prf = await prfBytes() }
            catch (e) {
                if (e.code === 'ENOPRF') { status.replaceWith(h('p', { class: 'warn' }, 'The passkey signed but gave no PRF bytes: this provider cannot be a door here. The recovery code is the way in on this device.')); return }
                status.replaceWith(h('div', { class: 'warn' }, h('p', {}, `No passkey answered (${err(e)}). If you have none for this site yet, make one:`),
                    h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn primary', onclick: makePasskey }, 'Make a passkey for this site'))))
                return
            }
            status.textContent = 'Deriving the door from the bytes…'
            const door = await doorFrom(prf.bytes)
            try {
                status.textContent = 'Opening the door, the master and the reader vault…'
                await openAll({ door, path: prf.path, credId: prf.credId })
                await drawUnlocked()
            } catch (e) {
                if (e.code === 'ENOVAULT') drawNoDoor(door, prf)
                else status.replaceWith(h('p', { class: 'warn' }, err(e)))
            }
        })
    }

    async function makePasskey() {
        try {
            await navigator.credentials.create({ publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { id: location.hostname, name: 'SGit Newsroom' },
                user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'reader', displayName: 'A reader of the SGit Newsroom' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
                extensions: { prf: { eval: { first: await sha256(PRF_INPUT_TEXT) } } }, timeout: 120000,
            } })
            drawLocked(h('p', { class: 'ok' }, 'A passkey was made for this site. Now enable the vault with it.'))
        } catch (e) { drawLocked(h('p', { class: 'warn' }, `The passkey was not made: ${err(e)}`)) }
    }

    function drawNoDoor(door, prf) {
        const access = h('input', { type: 'password', autocomplete: 'off', placeholder: 'kept in memory, then inside your master vault' })
        const code = h('input', { type: 'text', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX' })
        fill(
            h('p', { class: 'warn', id: 'vault-nodoor' }, `No door here for this path yet (${door.vaultId}, ${prf.path}). Either this is your first device, or your account was made through another path.`),
            h('h3', {}, 'First device: create the account'),
            h('p', { class: 'dim' }, 'Three vaults are made: this door, a master and a reader vault. The access key is the thing a reader buys; it is written into the master so no other device needs it typed.'),
            h('label', {}, 'Access key', access),
            h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn primary', id: 'vault-create', onclick: () => createAccount(door, prf, access.value.trim()) }, 'Create the account')),
            h('h3', {}, 'Another device of an existing account'),
            h('p', { class: 'dim' }, 'Type the recovery code once: it opens the recovery door, the master comes with its access key, and this path gets a door of its own.'),
            h('label', {}, 'Recovery code', code),
            h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', id: 'vault-join', onclick: () => joinWithCode(code.value, door, prf) }, 'Add this device with the code')),
            h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', onclick: () => drawLocked() }, 'Back')),
        )
    }

    function drawRecover() {
        const code = h('input', { type: 'text', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX' })
        fill(
            h('h3', {}, 'Open with the recovery code'),
            h('p', { class: 'dim' }, 'The code derives the recovery door, which holds the same master key. Use it on a device whose passkey cannot be a door, or to add a passkey path afterwards.'),
            h('label', {}, 'Recovery code', code),
            h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn primary', id: 'vault-join', onclick: () => joinWithCode(code.value, null, null) }, 'Open'), h('button', { type: 'button', class: 'btn', onclick: () => drawLocked() }, 'Back')),
        )
    }

    async function createAccount(door, prf, token) {
        if (!token) { body.prepend(h('p', { class: 'warn' }, 'An access key is needed to create the vaults.')); return }
        await withBusy('vault-create', async () => {
            const status = h('p', { class: 'dim' }, 'Creating three vaults: six key derivations and three first commits…'); body.prepend(status)
            try {
                const sg = await client(token)
                const a = await NV.createAccount({ sgSend: sg, door, record: { kind: 'passkey', path: prf.path, credential_id: prf.credId, device: label || deviceId } })
                await NV.writeFile(a.master, TOKEN_FILE.folder, TOKEN_FILE.name, JSON.stringify({ token }))
                await NV.writeFile(a.master, '/', 'recovery.json', JSON.stringify({ v: 1, note: 'the recovery code is shown once and kept by the reader; this file records only that one exists', made: new Date().toISOString() }))
                await NV.publish(a.master)
                const rc = recoveryCode()
                const rdoor = await doorFrom(rc.bytes)
                const added = await NV.addDoor({ sgSend: sg, master: a.master, door: rdoor, record: { kind: 'recovery', device: label || deviceId } })
                const cfgNow = meterCfg()
                await NV.writeFile(a.reader, '/activity', 'account.json', JSON.stringify(accountFile(cfgNow, deviceId), null, 1))
                await NV.publish(a.reader)
                state.vaults = { door: a.door, master: a.master, reader: a.reader, doors: added.doors || a.doors, record: a.record, token }
                state.lane = false
                session.set({ door, path: prf.path, credId: prf.credId, token }); setButtons()
                await drawUnlocked(h('div', { class: 'warn', id: 'vault-recovery-shown' }, h('p', {}, h('b', {}, 'Your recovery code, shown once. Write it down: '), h('span', { class: 'mono' }, rc.shown)), h('p', { class: 'dim' }, 'It opens a second door to the same master, for a device with no passkey and for the day the passkey is gone. The page does not keep it.')))
            } catch (e) { status.replaceWith(h('p', { class: 'warn' }, e.code === 'EEXISTS' ? 'A vault already exists at this door: enable again to open it.' : err(e))) }
        })
    }

    async function joinWithCode(codeText, door, prf) {
        const bytes = recoveryBytes(codeText)
        if (!bytes) { body.prepend(h('p', { class: 'warn' }, 'That is not a 26-character recovery code.')); return }
        await withBusy('vault-join', async () => {
            const status = h('p', { class: 'dim' }, 'Opening the recovery door…'); body.prepend(status)
            try {
                const rdoor = await doorFrom(bytes)
                const u = await openAll({ door: rdoor, path: 'recovery' })
                if (door && prf) {
                    status.textContent = 'Adding this passkey path as a door…'
                    if (!u.token) throw new Error('The master holds no access key, so a door cannot be written from here; create the account again with one.')
                    const sg = await client(u.token)
                    await NV.addDoor({ sgSend: sg, master: u.master, door, record: { kind: 'passkey', path: prf.path, credential_id: prf.credId, device: label || deviceId } })
                    session.set({ door, path: prf.path, credId: prf.credId, token: u.token })
                }
                await drawUnlocked(h('p', { class: 'ok' }, door ? 'This device now has a door of its own; the code is not needed here again.' : 'Opened with the recovery code.'))
            } catch (e) { status.replaceWith(h('p', { class: 'warn' }, e.code === 'ENOVAULT' ? 'No account answers to that code.' : err(e))) }
        })
    }

    async function drawUnlocked(note) {
        const v = state.vaults, cfgNow = meterCfg(), st = readState(cfgNow.storageKey)
        const local = st ? { reads: (st.log || []).length, own: (st.log || []).filter(e => !e.device || e.device === deviceId).length, balance: st.balance } : null
        const notes = N.list().length, ownNotes = N.own().length
        const device = h('input', { type: 'text', value: label, maxlength: 40, placeholder: 'this device, e.g. "my laptop"' })
        device.addEventListener('change', () => { label = device.value.trim(); try { localStorage.setItem(LABEL, label) } catch (e) { /* fine */ } })
        const access = h('input', { type: 'password', autocomplete: 'off', placeholder: 'kept in memory, then inside your master vault' })
        const across = h('div', { id: 'vault-across' }, h('p', { class: 'dim' }, 'Reading the devices’ files…'))
        fill(
            note || null,
            h('h3', {}, 'This device'),
            row('Device', h('span', {}, h('span', { class: 'mono' }, deviceId), label ? ` · ${label}` : '')),
            h('label', {}, 'Label', device),
            row('Door', h('span', { class: 'mono' }, `${v.door.vaultId}${session.get() && session.get().path ? ' · ' + session.get().path : ''}`)),
            row('Master', h('span', { class: 'mono' }, v.master.vaultId)),
            row('Reader vault', v.reader ? h('span', { class: 'mono' }, v.reader.vaultId) : 'none'),
            row('Access key', v.token ? 'in the master vault, in memory here' : 'none in the master: add it below, once, and every device gets it'),
            v.token ? null : h('div', { class: 'warn', id: 'vault-notoken' },
                h('p', {}, 'This account was made without an access key in its master, so nothing can be written yet. Paste the key once: it is written into the master, and from then on every device of yours finds it there.'),
                h('label', {}, 'Access key', access),
                h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn primary', id: 'vault-add-token', onclick: () => addToken(access.value.trim()) }, 'Add the access key'))),
            local ? row('Here', `${local.own} read(s) of this device, ${local.reads - local.own} brought in, balance ${money(local.balance, cfgNow.symbol)}; ${ownNotes} note(s) of this device, ${notes - ownNotes} brought in`) : row('Here', `no reading account in this browser yet; ${ownNotes} note(s) of this device`),
            row('Not yet in the vault', (p => p.any ? describePending(p) : 'nothing: the vault has everything of this device')(pending())),
            h('div', { class: 'acts' },
                h('button', { type: 'button', class: 'btn primary', id: 'vault-sync', disabled: !v.token || !v.reader, onclick: sync }, 'Update the vault'),
                h('button', { type: 'button', class: 'btn', id: 'vault-refresh', onclick: () => refreshAcross() }, 'Check the vault'),
                h('button', { type: 'button', class: 'btn', onclick: () => { session.set(null); state.vaults = null; state.lane = null; setButtons(); if (pageDrawn) renderSteps(); drawLocked(h('p', { class: 'dim' }, 'Forgotten on this device; the vault is unchanged.')) } }, 'Forget on this device')),
            h('div', { id: 'vault-sync-out' }),
            h('h3', {}, 'Across your devices'), across,
            h('h3', { id: 'vault-inbox-h' }, 'Send from another browser'), h('div', { id: 'vault-inbox' }),
            h('p', { class: 'dim' }, 'The keys of every vault of this account are in the Keys tab; your notes and the lane to the newsroom in This page.'),
        )
        await refreshAcross()
        await drawInbox()
    }

    /** An account made without an access key in its master (the lab's early accounts): write it in, once. */
    async function addToken(token) {
        if (!token) { body.prepend(h('p', { class: 'warn' }, 'Paste the access key first.')); return }
        await withBusy('vault-add-token', async () => {
            const status = h('p', { class: 'dim' }, 'Writing the access key into the master…'); body.prepend(status)
            try {
                const sg = await client(token)
                await NV.writeFile(state.vaults.master, TOKEN_FILE.folder, TOKEN_FILE.name, JSON.stringify({ token }))
                await NV.publish(state.vaults.master)
                state.vaults.token = token
                session.set({ ...(session.get() || {}), token }); setButtons()
                await drawUnlocked(h('p', { class: 'ok', id: 'vault-token-added' }, 'The access key is in the master now; every device of yours gets it from there.'))
            } catch (e) { status.replaceWith(h('p', { class: 'warn' }, /401|403|access token/i.test(String(e && e.message)) ? `The vault server refused that key (${err(e)}). Check it and try again.` : err(e))) }
        })
    }

    // ------------------------------------------------------------ the inbox: send to my vault from any browser (card 049)
    const when = at => String(at || '').slice(0, 16).replace('T', ' ')
    const fileTime = id => { const ms = Number(String(id || '').split('_')[0]); return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '' }
    async function drawInbox(note) {
        const box = document.getElementById('vault-inbox'); if (!box) return
        const v = state.vaults
        if (state.inbox === undefined) { try { state.inbox = await NV.readInbox(v.master) } catch (e) { state.inbox = null } }
        const rec = state.inbox
        if (!rec) {
            put(box, note || null,
                h('p', { class: 'dim' }, 'A browser that cannot reach your passkey (one an app opens links in, one signed in to nothing, an old iPad) can still send what it holds to this vault, through a lane it can write to and never read. Make the link once, here; open it, paste it or scan it in that browser.'),
                h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', id: 'vault-inbox-make', disabled: !v.token || !v.reader, onclick: makeInbox }, 'Make a link for another browser')))
            return
        }
        const url = I.linkUrl(rec, ROOT), code = I.linkCode(rec)
        const qr = h('div', { class: 'inbox-qr', id: 'vault-inbox-qr' })
        I.qrSvg(url).then(q => { qr.innerHTML = q.svg; qr.dataset.modules = String(q.modules) }).catch(e => { qr.textContent = `The QR code could not be drawn: ${err(e)}` })
        put(box, note || null,
            h('div', { id: 'vault-inbox-waiting' }, h('p', { class: 'dim' }, 'Looking in the lane…')),
            h('div', { class: 'inbox-link' },
                row('The link', h('span', {}, h('a', { href: url, class: 'mono', id: 'vault-inbox-url', target: '_blank', rel: 'noopener', title: 'the whole link is copied' }, shorten(url.replace(/^https?:\/\//, ''), 44)), ' ', copyBtn(url))),
                row('As text', h('span', {}, h('span', { class: 'mono', id: 'vault-inbox-code', 'data-code': code }, `${code.slice(0, 30)}… (${code.length} characters)`), ' ', copyBtn(code))),
                row('Its key', h('span', { class: 'mono', id: 'vault-inbox-fp' }, `${rec.fingerprint}, RSA-OAEP 3072`))),
            qr,
            h('p', { class: 'dim' }, 'Open the link in the other browser, paste the text there, or scan the code with its camera. It carries where to write and the key to encrypt to, nothing else: whoever holds it can add to the lane and read nothing. The private key and the key that lists the lane are in your master vault. What arrives is shown here before it is brought in.'),
            h('div', { class: 'acts' },
                h('button', { type: 'button', class: 'btn', id: 'vault-inbox-check', onclick: () => checkInbox() }, 'Look in the lane'),
                h('button', { type: 'button', class: 'btn', id: 'vault-inbox-rotate', onclick: rotateInbox }, 'Make a new link (the old one stops working)')))
        await checkInbox()
    }
    async function checkInbox() {
        const box = document.getElementById('vault-inbox-waiting'); if (!box || !state.inbox) return
        put(box, h('p', { class: 'dim' }, 'Looking in the lane…'))
        try {
            const items = await I.drain(state.inbox)
            state.waiting = items
            if (!items.length) { put(box, h('p', { class: 'dim', id: 'vault-inbox-empty' }, 'Nothing waiting in the lane.')); return }
            const good = items.filter(x => !x.problems.length), bad = items.filter(x => x.problems.length)
            put(box,
                h('p', { class: 'ok', id: 'vault-inbox-count' }, `${items.length} message(s) waiting in the lane: ${good.length} from your other browsers${bad.length ? `, ${bad.length} refused` : ''}.`),
                h('ul', { class: 'waiting', id: 'vault-inbox-list' }, ...items.map(x => {
                    if (x.problems.length) return h('li', { class: 'refused', 'data-file': x.file_id }, `Refused, received ${when(x.received || fileTime(x.file_id))}: ${x.problems.join('; ')}.`)
                    const d = x.msg.file.device, c = I.carried(x.msg.file)
                    return h('li', { 'data-file': x.file_id, 'data-device': d.id }, h('b', {}, d.label || d.id), d.agent ? ` (${d.agent})` : '', `, sent ${when(x.msg.sent_at)}: ${c.reads} read(s), ${c.notes} note(s), ${c.topups} top-up(s), ${c.seen} wire stories seen.`)
                })),
                h('div', { class: 'acts' },
                    good.length ? h('button', { type: 'button', class: 'btn primary', id: 'vault-inbox-take', onclick: () => takeIn(good) }, good.length === 1 ? 'Bring it in' : 'Bring them in') : null,
                    h('button', { type: 'button', class: 'btn', id: 'vault-inbox-discard', onclick: () => discard(items) }, items.length === 1 ? 'Discard it' : 'Discard them all')))
        } catch (e) { put(box, h('p', { class: 'warn' }, `The lane could not be read: ${err(e)}`)) }
    }
    const byLane = items => { const m = new Map(); for (const x of items) { if (!m.has(x.inbox)) m.set(x.inbox, []); m.get(x.inbox).push(x.file_id) } return m }
    /** What other browsers sent, written into the reader vault as their device files, the lane marked, then the usual merge. */
    async function takeIn(items) {
        await withBusy('vault-inbox-take', async () => {
            const box = document.getElementById('vault-inbox-waiting'), v = state.vaults
            try {
                try { await v.reader.pull() } catch (e) { /* fine */ }
                const byDevice = new Map()
                for (const x of [...items].sort((a, b) => String(a.msg.sent_at).localeCompare(String(b.msg.sent_at)))) { const id = x.msg.file.device.id; byDevice.set(id, combine(byDevice.get(id), x.msg.file)) }
                for (const [id, file] of byDevice) {
                    if (id === deviceId) continue                                  // this browser's own records are here already
                    const prev = await NV.readJson(v.reader, PATHS.device(id)).catch(() => null)
                    await NV.writeFile(v.reader, PATHS.devicesFolder, `${id}.json`, JSON.stringify(combine(prev, file), null, 1))
                }
                await NV.publish(v.reader)
                for (const [inbox, ids] of byLane(items)) await I.markProcessed(state.inbox, inbox, ids)
                state.consolidated = null; state.waiting = []
                await merge()                                                      // reloads, and says what arrived
            } catch (e) { if (box) box.prepend(h('p', { class: 'warn' }, `Not brought in: ${err(e)}`)) }
        })
    }
    async function discard(items) {
        await withBusy('vault-inbox-discard', async () => {
            try { for (const [inbox, ids] of byLane(items)) await I.markProcessed(state.inbox, inbox, ids); await checkInbox() }
            catch (e) { const box = document.getElementById('vault-inbox-waiting'); if (box) box.prepend(h('p', { class: 'warn' }, `Not discarded: ${err(e)}`)) }
        })
    }
    async function makeInbox() {
        await withBusy('vault-inbox-make', async () => {
            const v = state.vaults
            try {
                put(document.getElementById('vault-inbox'), h('p', { class: 'dim' }, 'Making a key pair in this browser and opening the lane on your reader vault…'))
                const rec = await I.newInbox({ vault: v.reader.vaultId, endpoint: ENDPOINT, device: label || deviceId })
                await I.configure(rec, { writeKey: v.reader.writeKeyHex, accessToken: v.token })
                await NV.writeInbox(v.master, rec)
                state.inbox = rec
                await drawInbox(h('p', { class: 'ok', id: 'vault-inbox-made' }, 'The link is made. Its private key and the key that lists the lane are in your master vault; the link carries neither.'))
            } catch (e) { state.inbox = undefined; await drawInbox(h('p', { class: 'warn' }, `The link was not made: ${err(e)}`)) }
        })
    }
    async function rotateInbox() {
        const box = document.getElementById('vault-inbox')
        if (state.waiting.length) { box.prepend(h('p', { class: 'warn', id: 'vault-inbox-rotate-wait' }, 'Bring in or discard what is waiting first: a new link starts a new lane.')); return }
        await withBusy('vault-inbox-rotate', async () => {
            const v = state.vaults
            try {
                const rec = I.rotated(state.inbox, label || deviceId)
                await I.configure(rec, { writeKey: v.reader.writeKeyHex, accessToken: v.token })
                await NV.writeInbox(v.master, rec)
                state.inbox = rec
                await drawInbox(h('p', { class: 'ok', id: 'vault-inbox-rotated' }, 'A new link is made, with the same key. The old one can no longer write to the lane.'))
            } catch (e) { box.prepend(h('p', { class: 'warn' }, `No new link: ${err(e)}`)) }
        })
    }

    async function readAll() {
        const v = state.vaults
        const names = (await NV.listFiles(v.reader, PATHS.devicesFolder).catch(() => [])).filter(n => n.endsWith('.json'))
        const files = []
        for (const n of names) { try { files.push(await NV.readJson(v.reader, `${PATHS.devicesFolder}/${n}`)) } catch (e) { /* a bad file is left out */ } }
        const account = await NV.readJson(v.reader, PATHS.account).catch(() => null)
        state.consolidated = consolidate(files, account || { start: meterCfg().start })
        return state.consolidated
    }

    async function refreshAcross() {
        const across = document.getElementById('vault-across'); if (!across) return
        try {
            const v = state.vaults
            if (v.reader) { try { await v.reader.pull() } catch (e) { /* unpushed local commits, or nothing new */ } }
            const c = await readAll(), sym = meterCfg().symbol
            const others = c.devices.filter(d => d.id !== deviceId)
            across.replaceChildren(
                c.devices.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Device'), h('th', { class: 'n' }, 'Reads'), h('th', { class: 'n' }, 'Spent'), h('th', { class: 'n' }, 'Top-ups'), h('th', { class: 'n' }, 'Notes'), h('th', {}, 'Last sync'))),
                    h('tbody', {}, ...c.devices.map(d => h('tr', { class: d.id === deviceId ? 'me' : '' }, h('td', {}, d.label || d.id, d.id === deviceId ? ' (here)' : ''), h('td', { class: 'n' }, d.reads), h('td', { class: 'n' }, money(d.spent, sym)), h('td', { class: 'n' }, d.credit ? money(d.credit, sym) : '–'), h('td', { class: 'n' }, d.notes || 0), h('td', {}, String(d.last_sync || '').slice(0, 16).replace('T', ' ')))),
                        h('tr', { class: 'total' }, h('td', {}, `All, ${c.devices.length} device(s)`), h('td', { class: 'n' }, c.totals.reads), h('td', { class: 'n' }, money(c.totals.spent, sym)), h('td', { class: 'n' }, money(c.totals.credit, sym)), h('td', { class: 'n' }, c.totals.notes), h('td', {}, `balance ${money(c.totals.balance, sym)}`))))
                    : h('p', { class: 'dim' }, 'No device has updated the vault yet.'),
                h('p', { class: 'dim' }, `Totals are recomputed from the records: starting credit ${money(c.start, sym)}, plus top-ups, minus what was read and not declined. The vault holds records, never totals.`),
                others.length ? h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn', id: 'vault-merge', onclick: merge }, `Bring ${others.length === 1 ? 'that device’s' : 'their'} activity here`)) : null,
            )
        } catch (e) { across.replaceChildren(h('p', { class: 'warn' }, `The devices’ files could not be read: ${err(e)}`)) }
    }

    /** This device's file, written whole into the reader vault and published: the one write of the sync model. */
    async function writeDevice() {
        const v = state.vaults, cfgNow = meterCfg(), st = readState(cfgNow.storageKey) || emptyState(cfgNow)
        try { await v.reader.pull() } catch (e) { /* fine */ }
        const prev = await NV.readJson(v.reader, PATHS.device(deviceId)).catch(() => null)
        const file = extract(st, { id: deviceId, label, agent: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '' }, prev, { notes: N.own(), wire: W.read().seen })
        await NV.writeFile(v.reader, PATHS.devicesFolder, `${deviceId}.json`, JSON.stringify(file, null, 1))
        if (!(await NV.readJson(v.reader, PATHS.account).catch(() => null))) await NV.writeFile(v.reader, '/activity', 'account.json', JSON.stringify(accountFile(cfgNow, deviceId), null, 1))
        await NV.publish(v.reader)
        try { localStorage.setItem(LAST_SYNC, file.device.last_sync) } catch (e) { /* fine */ }
        renderPending()
        return file
    }
    async function sync() {
        await withBusy('vault-sync', async () => {
            const out = document.getElementById('vault-sync-out'); out.replaceChildren(h('p', { class: 'dim' }, 'Writing this device’s records as one commit, then publishing…'))
            try {
                const file = await writeDevice()
                out.replaceChildren(h('p', { class: 'ok', id: 'vault-synced' }, `Updated: ${describe(file)}, as one commit, published. Sync ${file.device.syncs} from this device.`))
                await refreshAcross()
            } catch (e) { out.replaceChildren(h('p', { class: 'warn' }, `The vault was not updated: ${err(e)}`)) }
        })
    }

    async function merge() {
        await withBusy('vault-merge', async () => {
            const cfgNow = meterCfg(), st = readState(cfgNow.storageKey) || emptyState(cfgNow)
            const c = state.consolidated || await readAll()
            const m = mergeInto(st, c, deviceId)
            const mn = mergeNotes(N.read(), c, deviceId)
            const mw = mergeWire(W.read(), c, deviceId)
            try { localStorage.setItem(cfgNow.storageKey, JSON.stringify(m.state)); N.write(mn.store); W.write(mw.store) } catch (e) { document.getElementById('vault-across').prepend(h('p', { class: 'warn' }, 'This browser’s storage refused the write.')); return }
            try { sessionStorage.setItem('sgit.vault.merged', JSON.stringify({ at: Date.now(), added: { ...m.added, notes: mn.added, seen: mw.added } })) } catch (e) { /* fine */ }
            location.reload()
        })
    }

    renderPending()

    // open on arrival: the vault page and #vault on the Vault tab, #notes on This page, #reading on Reading, and
    // otherwise as it was on the page before, so the pane stays open from page to page (after every declaration above)
    let remembered = ''; try { remembered = sessionStorage.getItem(OPEN) || '' } catch (e) { /* fine */ }
    if (location.hash === '#vault' || document.documentElement.hasAttribute('data-vault-open')) { state.tab = 'vault'; toggle(true) }
    else if (location.hash === '#notes') toggle(true)
    else if (location.hash === '#reading') { state.tab = 'reading'; toggle(true) }
    else if (remembered) { state.tab = remembered; toggle(true) }

    // after a merge, say what arrived
    try {
        const m = JSON.parse(sessionStorage.getItem('sgit.vault.merged') || 'null')
        if (m && Date.now() - m.at < 10000) { sessionStorage.removeItem('sgit.vault.merged'); state.tab = 'vault'; toggle(true); setTimeout(() => body.prepend(h('p', { class: 'ok', id: 'vault-merged' }, `Brought in: ${m.added.reads} read(s), ${m.added.topups} top-up(s), ${m.added.personas} persona(s), ${m.added.notes || 0} note(s)${m.added.seen ? `, ${m.added.seen} wire stories seen elsewhere` : ''}. The meter now shows the consolidated figures.`)), 50) }
    } catch (e) { /* fine */ }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()
}
