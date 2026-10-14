/**
 * send.js: the sending side of the inbox (card 049), for any browser that holds the link to a reader's inbox.
 *
 * The browser needs no passkey, no sign-in and no vault library: it reads what it holds of its own from local storage
 * (the meter's reads and top-ups, the notes, the stories seen on the wire), writes it as one device file in the
 * format of assets/vault-pane/sync.js, seals it to the key in the link (assets/vault-pane/inbox.js) and appends it to
 * the lane. It can add to the lane and cannot read anything back, not even what it sent. Nothing is removed from this
 * browser: the records stay here, and the vault takes its copy in the next time it is opened with the passkey.
 *
 * The link is remembered in this browser (localStorage sgit.inbox.link) so that later sends are one press, here on
 * vault/send.html or from the strip above the pane's tabs. It is a write-only lane address and a public key: it can
 * add to the lane and read nothing. Forget the link removes it.
 *
 * @module inbox-send
 */
import * as I from './inbox.js'
import { extract, describe } from './sync.js'
import * as N from './notes.js'
import * as W from './wire-state.js'
import { pending, describePending, LAST_SYNC } from './pending.js'
import { deviceBranch } from '../newsroom-vault.js'

export const LINK = 'sgit.inbox.link', SENT = 'sgit.inbox.sent', LABEL = 'sgit.device-label'
export const EVENT = 'sgit-inbox-sent'
const ls = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* fine */ } }, del(k) { try { localStorage.removeItem(k) } catch (e) { /* fine */ } } }

/** The link this browser remembers, parsed; null when there is none. */
export function remembered() { return I.parseLink(ls.get(LINK) || '') }
export function remember(link) { ls.set(LINK, link.code) }
export function forget() { ls.del(LINK) }
export function lastSent() { try { return JSON.parse(ls.get(SENT) || 'null') } catch (e) { return null } }

function meterState() {
    let key = 'sgit.meter.v1'
    try { const el = document.getElementById('sg-meter-config'); if (el) key = JSON.parse(el.textContent).storageKey || key } catch (e) { /* default */ }
    try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null }
}

/** This browser's own records as one device file, sealed to the link's key and appended. Returns { file, fingerprint }. */
export async function sendNow(link, { label = ls.get(LABEL) || '' } = {}) {
    if (!globalThis.crypto || !crypto.subtle) throw new Error('this browser cannot encrypt here')
    const fp = await I.fingerprint(link.spki)
    const prev = lastSent()
    const st = meterState() || {}
    const device = { id: deviceBranch(), label, agent: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '' }
    const file = extract(st, device, prev && prev.vault === link.vault ? { device: { first_sync: prev.first, syncs: prev.syncs } } : null, { notes: N.own(), wire: W.read().seen })
    file.device.via = 'inbox'
    const { payload } = await I.seal(link.spki, JSON.stringify(I.message(file, fp, file.device.last_sync)))
    await I.append(link, payload)
    ls.set(SENT, JSON.stringify({ at: file.device.last_sync, first: file.device.first_sync, syncs: file.device.syncs, vault: link.vault, fingerprint: fp }))
    ls.set(LAST_SYNC, file.device.last_sync)                                 // what was sent is no longer only in this browser
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { file: describe(file) } })) } catch (e) { /* fine */ }
    return { file, fingerprint: fp }
}

// ------------------------------------------------------------ the page: vault/send.html
const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v) }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}
const when = at => String(at || '').slice(0, 16).replace('T', ' ')

export function mountSend(mount) {
    // the link from the address, kept here, and taken out of the address so a copy or a screenshot does not carry it
    const fromHash = I.parseLink(decodeURIComponent(location.hash || ''))
    if (fromHash) { remember(fromHash); try { history.replaceState(null, '', location.pathname + location.search) } catch (e) { /* fine */ } }
    const out = h('div', { id: 'send-out', 'aria-live': 'polite' })
    const put = (...kids) => mount.replaceChildren(...kids.flat().filter(k => k != null && k !== false && k !== ''))   // replaceChildren would print a null
    async function draw(note) {
        const link = remembered(), p = pending(), last = lastSent()
        if (!link) {
            const paste = h('textarea', { id: 'send-paste', rows: 3, placeholder: 'https://newsroom.sgit.ai/vault/send.html#sgi1.… or sgi1.…' })
            put(note,
                h('p', {}, 'This browser holds no link to a vault yet. Open the link your vault shows (its URL, or its QR code with the camera), or paste it here.'),
                paste,
                h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn primary', id: 'send-use', onclick: () => { const l = I.parseLink(paste.value); if (!l) { draw(h('p', { class: 'warn', id: 'send-bad' }, 'That is not a link to a vault’s inbox: it starts with sgi1. and is about 600 characters long.')); return } remember(l); draw() } }, 'Use this link')),
                out)
            return
        }
        const fp = await I.fingerprint(link.spki)
        const label = h('input', { type: 'text', id: 'send-label', maxlength: 40, value: ls.get(LABEL) || '', placeholder: 'this browser, e.g. "iPhone, in WhatsApp"' })
        label.addEventListener('change', () => ls.set(LABEL, label.value.trim()))
        const btn = h('button', { type: 'button', class: 'btn primary', id: 'send-now', onclick: async () => {
            btn.disabled = true; out.replaceChildren(h('p', { class: 'dim' }, 'Encrypting in this browser, then appending to the lane…'))
            try {
                ls.set(LABEL, label.value.trim())
                const r = await sendNow(link, { label: label.value.trim() })
                out.replaceChildren()
                draw(h('p', { class: 'ok', id: 'send-sent' }, `Sent: ${describe(r.file)}, encrypted to ${r.fingerprint}, at ${when(r.file.device.last_sync)}. Your vault takes it in the next time you open it with your passkey; it stays in this browser too.`))
            } catch (e) { out.replaceChildren(h('p', { class: 'warn', id: 'send-failed' }, `Not sent: ${String(e && e.message || e)}. Nothing was lost; it is all still in this browser.`)); btn.disabled = false }
        } }, p.any ? 'Send to my vault' : 'Send again')
        put(note,
            h('div', { class: 'kv' }, h('span', { class: 'k' }, 'The vault'), h('span', { class: 'v mono', id: 'send-vault' }, `${link.vault} · key ${fp}`)),
            h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Only in this browser'), h('span', { class: 'v', id: 'send-pending' }, p.any ? `${p.count ? `${p.count} change(s): ` : ''}${describePending(p)}` : 'nothing new since the last send')),
            last && last.vault === link.vault ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Last sent from here'), h('span', { class: 'v' }, when(last.at))) : null,
            h('label', {}, 'A name for this browser, so you know it in your vault ', label),
            h('div', { class: 'acts' }, btn, h('button', { type: 'button', class: 'btn', id: 'send-forget', onclick: () => { forget(); draw(h('p', { class: 'dim' }, 'This browser no longer holds the link.')) } }, 'Forget the link')),
            out)
    }
    draw()
    window.addEventListener(N.EVENT, () => { if (!document.getElementById('send-paste')) draw() })
}
