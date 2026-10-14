#!/usr/bin/env node
/* test_inbox.mjs: send to my vault from any browser (card 049, the brief in "Sixteen notes I did not want to lose").
 *
 *   export NODE_PATH=$(npm root -g); node admin/build/test_inbox.mjs
 *
 * In Node: the link as text and as a URL, the envelope (sgit's hybrid v2 to a 3072-bit RSA-OAEP key), a message
 * sealed to another key, a ciphertext changed on the way, a message of the wrong kind, a device id that is not a file
 * name, and two files of one device combined. In Chromium, against the mock of the vault API (admin/build/vault-mock.mjs,
 * with the append routes): browser A, with a virtual passkey, makes the account and the link (URL, text, QR code; the
 * QR decoded back with jsQR); browser B, with no passkey at all, reads, keeps notes, opens the link and sends, then
 * sends again from the strip above the pane; three bad messages are appended beside them; A lists what is waiting,
 * refuses the three with their reasons, brings B's two in (B's records arrive tagged with B), discards the rest, makes
 * a new link, and the old one can no longer write. What reached the server is ciphertext; no private key, enum key or
 * vault key is in either browser's storage.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { startMock } from './vault-mock.mjs'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
needsChromium('the inbox (a virtual authenticator over CDP)')
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const I = await import(path.join(API, 'assets/vault-pane/inbox.js'))
const { combine } = await import(path.join(API, 'assets/vault-pane/sync.js'))
const g = (() => { try { return execSync('npm root -g').toString().trim() } catch (e) { return '' } })()
let chromium, jsQR
try { ({ chromium } = await import('playwright')) } catch (e) { try { ({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) } catch (e2) { console.log('SKIP: playwright is not installed'); process.exit(0) } }
try { jsQR = (await import('jsqr')).default } catch (e) { try { jsQR = (await import(path.join(g, 'jsqr', 'dist', 'jsQR.js'))).default } catch (e2) { console.log('SKIP: jsqr is not installed (npm install jsqr@1.4.0), so the QR code could not be decoded'); process.exit(0) } }

// ---------------------------------------------------------------- the pieces, in Node
const rec = await I.newInbox({ vault: 'abcd1234', device: 'nr-test' })
const url = I.linkUrl(rec, 'https://newsroom.sgit.ai/'), code = I.linkCode(rec)
check(url === `https://newsroom.sgit.ai/vault/send.html#${code}` && code.startsWith('sgi1.abcd1234.' + rec.token + '.') && !url.includes(rec.enum_key) && !url.includes(rec.private.slice(10, 60)), `the link: where to write and the public key, nothing else (${url.length} characters)`)
const l1 = I.parseLink(`open this: ${url} thanks`), l2 = I.parseLink(code)
check(l1 && l2 && l1.vault === 'abcd1234' && l1.token === rec.token && (await I.fingerprint(l1.spki)) === rec.fingerprint && l2.code === code, 'the link is read back from a URL in a sentence, or from the text alone')
check(!I.parseLink('sgi1.abcd1234.nothex.' + 'A'.repeat(300)) && !I.parseLink('sgi2.' + code.slice(5)) && !I.parseLink(''), 'something that is not a link is not read as one')
const fileB = { v: 1, device: { id: 'nr-phone01', label: 'phone', last_sync: '2026-10-13T10:00:00.000Z', first_sync: '2026-10-13T10:00:00.000Z', syncs: 1 }, reads: [{ id: 'r-1', at: '2026-10-13T09:00:00Z', device: 'nr-phone01' }], topups: [], personas: [], notes: [{ id: 'n-1', at: '2026-10-13T09:10:00Z', kind: 'liked', device: 'nr-phone01' }], wire: { seen: {} } }
const sealed = await I.seal(l1.spki, JSON.stringify(I.message(fileB, rec.fingerprint)))
const opened = JSON.parse(await I.unseal(I.unb64(rec.private), sealed.payload))
check(opened.kind === I.KIND && opened.file.device.id === 'nr-phone01' && I.problems(opened, rec.fingerprint).length === 0, 'sealed to the key in the link, opened with the private key, and taken as a message for this inbox')
check(!sealed.payload.includes('nr-phone01') && !Buffer.from(Buffer.from(sealed.payload, 'base64').toString(), 'base64').toString().includes('liked'), 'the payload is ciphertext: no device, no note in it')
const other = await I.newInbox({ vault: 'zzzz9999' })
const foreign = await I.seal(I.unb64(other.public), JSON.stringify(I.message(fileB, other.fingerprint)))
const env = JSON.parse(atob(atob(sealed.payload))); const c = I.unb64(env.c); c[7] ^= 1; env.c = I.b64(c); const tampered = btoa(btoa(JSON.stringify(env)))
let why = []
for (const p of [foreign.payload, tampered, 'bm90IGFuIGVudmVsb3Bl']) { try { await I.unseal(I.unb64(rec.private), p); why.push('opened') } catch (e) { why.push(e.message) } }
check(/not sealed to this inbox/.test(why[0]) && /changed on the way/.test(why[1]) && /not an envelope/.test(why[2]), `refused: another key, a changed ciphertext, not an envelope (${why.join(' | ')})`)
check(I.problems({ ...opened, kind: 'x' }, rec.fingerprint).length && I.problems({ ...opened, to: other.fingerprint }, rec.fingerprint).length && I.problems({ ...opened, file: { ...fileB, device: { id: '../master' } } }, rec.fingerprint).length && I.problems({ ...opened, file: { ...fileB, notes: [{ id: 'n-2', device: 'nr-laptop' }] } }, rec.fingerprint).length,
      'refused when opened: the wrong kind, addressed to another key, a device id that is not a file name, a note that claims another browser')
const older = { ...fileB, device: { ...fileB.device, last_sync: '2026-10-12T00:00:00.000Z', first_sync: '2026-10-11T00:00:00.000Z', syncs: 4 }, reads: [{ id: 'r-0', at: '2026-10-11T00:00:00Z' }] }
const cmb = combine(older, fileB)
check(cmb.reads.map(r => r.id).join() === 'r-1,r-0' && cmb.device.first_sync === '2026-10-11T00:00:00.000Z' && cmb.device.syncs === 4 && cmb.device.last_sync === fileB.device.last_sync, 'two files of one browser combine: every record, the earliest first sync, the newer header')
const rotatedRec = I.rotated(rec)
check(rotatedRec.token !== rec.token && rotatedRec.public === rec.public && rotatedRec.enum_key === rec.enum_key && rotatedRec.rotated.length === 1, 'a new link: a new token, the same key')

// ---------------------------------------------------------------- the two browsers, in Chromium
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.txt': 'text/plain', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    const f = path.join(ROOT, p)
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://localhost:${server.address().port}/`
const args = process.env.CHROMIUM_SPKI_ALLOW ? [`--ignore-certificate-errors-spki-list=${process.env.CHROMIUM_SPKI_ALLOW}`] : []
let browser
browser = await launch({ args })
const mock = await startMock()
const errors = []
async function browserCtx(name, { passkey, width = 1280, height = 900 }) {
    const ctx = await browser.newContext({ viewport: { width, height } }); await routeApi(ctx)
    if (!passkey) await ctx.addInitScript(() => { try { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true }) } catch (e) { /* fine */ } })
    const pg = await ctx.newPage()
    const seen = []
    pg.on('pageerror', e => errors.push(`${name}: ${e.message}`))
    pg.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`) })
    await pg.route('https://dev.send.sgraph.ai/**', async route => {
        const req = route.request(), u = new URL(req.url()), m = req.method()
        seen.push(`${m} ${u.pathname}`)
        const headers = {}
        for (const [k, v] of Object.entries(req.headers())) if (!/^(host|origin|referer|content-length|connection|accept-encoding)$/i.test(k) && !k.startsWith(':')) headers[k] = v
        const data = req.postDataBuffer()
        const r = await fetch(mock.base + u.pathname + u.search, { method: m, headers, body: data && m !== 'GET' && m !== 'HEAD' ? data : undefined })
        if ((m === 'GET' || m === 'HEAD') && r.status === 404) return route.continue()          // not the mock's: the wire's vault, live
        const out = {}; r.headers.forEach((v, k) => { if (!/^(content-length|transfer-encoding|connection)$/i.test(k)) out[k] = v })
        await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) })
    })
    if (passkey) {
        const cdp = await ctx.newCDPSession(pg)
        await cdp.send('WebAuthn.enable', { enableUI: false })
        await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } })
    }
    const text = sel => pg.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent : '' }, sel)
    const until = (re, ms = 90000) => pg.waitForFunction(re => new RegExp(re).test(((document.getElementById('sgit-vault-pane') || {}).textContent || '') + ((document.getElementById('send-mount') || {}).textContent || '')), re, { timeout: ms })
    const openPane = async tab => { if (!(await pg.evaluate(() => document.documentElement.classList.contains('vault-open')))) await pg.click('.vault-btn'); await pg.waitForTimeout(300); if (tab) { await pg.click(`#vault-tab-${tab}`); await pg.waitForTimeout(200) } }
    const storage = () => pg.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    return { ctx, pg, seen, text, until, openPane, storage }
}
const shot = async (pg, name, sel) => { if (!process.env.SHOTS) return; const el = sel ? await pg.$(sel) : null; await (el || pg).screenshot({ path: path.join(process.env.SHOTS, name) }) }   // SHOTS=<dir>: the card's screenshots
const appendTo = async (vid, token, payload) => (await fetch(`${mock.base}/api/vault/append/write/${vid}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ append_token: token, payload }) })).status

try {
    // ---- A: the account and the link
    const A = await browserCtx('A', { passkey: true })
    await A.pg.goto(B + 'vault/'); await A.pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await A.openPane('vault')
    await A.pg.click('#vault-enable'); await A.until('No passkey answered|No door here|Opening')
    if (/No passkey answered/.test(await A.text('#sgit-vault-pane'))) { await A.pg.click('#sgit-vault-pane button:has-text("Make a passkey for this site")'); await A.until('A passkey was made'); await A.pg.click('#vault-enable') }
    await A.until('No door here for this path yet')
    await A.pg.fill('#sgit-vault-pane input[type=password]', mock.token)
    await A.pg.click('#vault-create'); await A.until('Your recovery code|was not|Error', 120000)
    await A.pg.waitForSelector('#vault-inbox-make', { timeout: 60000 })
    check(/can still send what it holds/.test(await A.text('#vault-inbox')), 'the Vault tab offers a link for another browser')
    await A.pg.click('#vault-inbox-make'); await A.until('The link is made|was not made', 90000)
    check(!!(await A.pg.$('#vault-inbox-made')), `Make a link: ${(await A.text('#vault-inbox')).trim().slice(0, 80)}`)
    const theRec = await A.pg.evaluate(async () => {
        const NV = await import('/assets/newsroom-vault.js'); const s = JSON.parse(sessionStorage.getItem('sgit.vault.session'))
        const u = await NV.unlock({ sgSend: NV.client({ endpoint: 'https://dev.send.sgraph.ai', token: s.token }), door: s.door, cloneBranch: 'nr-test-read' })
        return { inbox: await NV.readInbox(u.master), reader: u.reader.vaultId }
    })
    const R = theRec.inbox, readerId = theRec.reader
    const urlA = await A.pg.evaluate(() => document.getElementById('vault-inbox-url').getAttribute('href')), codeA = await A.pg.evaluate(() => document.getElementById('vault-inbox-code').dataset.code)
    check(R && R.vault === readerId && R.private && R.enum_key && urlA.endsWith('/vault/send.html#' + codeA) && codeA === I.linkCode(R), 'the inbox record is in the master: the lane on the reader vault, the private key, the enum key; the link shown is made from it')
    const cfg = mock.appendCfg.get(readerId)
    check(cfg && cfg.anchors.size === 1 && cfg.anchors.has(crypto.createHash('sha256').update(R.token).digest('hex')) && cfg.enumHash === crypto.createHash('sha256').update(R.enum_key).digest('hex'), 'the lane is configured on the reader vault: the anchor is the token’s hash, and the enum key’s hash')
    check(!urlA.includes(R.enum_key) && !codeA.includes(R.private.slice(20, 80)) && (await A.text('#vault-inbox-fp')).includes(R.fingerprint), 'the link carries neither the enum key nor the private key; the pane shows the key’s fingerprint')
    await A.pg.waitForSelector('#vault-inbox-qr svg', { timeout: 20000 })
    const img = await A.pg.evaluate(async () => {
        const svg = document.querySelector('#vault-inbox-qr svg').outerHTML
        const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await im.decode()
        const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight
        const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0)
        const d = cx.getImageData(0, 0, cv.width, cv.height)
        return { w: d.width, h: d.height, data: Array.from(d.data) }
    })
    const qr = jsQR(Uint8ClampedArray.from(img.data), img.w, img.h)
    check(qr && qr.data === urlA, `the QR code reads back as the link (${img.w}×${img.h} px, ${qr ? qr.data.length : 0} characters)`)
    await A.pg.waitForSelector('#vault-inbox-empty', { timeout: 30000 })
    await shot(A.pg, '049-the-link.png', '#vault-inbox')
    check(true, 'nothing waiting in the lane yet')

    // ---- B: a browser with no passkey reads, keeps notes, and sends
    const Bb = await browserCtx('B', { passkey: false })
    await Bb.pg.goto(B + 'articles/the-site-is-an-inbox.html'); await Bb.pg.waitForSelector('.vault-btn', { timeout: 20000 })
    await Bb.pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await Bb.pg.waitForTimeout(900); await Bb.pg.evaluate(() => window.scrollTo(0, 0)); await Bb.pg.waitForTimeout(300)
    await Bb.openPane('page'); await Bb.pg.click('#note-liked'); await Bb.pg.waitForTimeout(200)
    await Bb.pg.fill('#note-words', 'kept on a phone that cannot reach my passkey'); await Bb.pg.click('#note-keep'); await Bb.pg.waitForTimeout(300)
    check(await Bb.pg.evaluate(() => typeof window.PublicKeyCredential === 'undefined'), 'browser B has no passkeys at all')
    const pendB = await Bb.pg.evaluate(async () => (await import('/assets/vault-pane/pending.js')).pending())
    check(pendB.count >= 2 && pendB.notes === 1 && pendB.reads >= 1, `B holds changes only in this browser (${pendB.count}: ${pendB.reads} read(s), ${pendB.notes} note(s))`)
    const deviceB = await Bb.pg.evaluate(() => localStorage.getItem('sgit.device-branch'))
    await Bb.pg.goto(urlA.replace('https://newsroom.sgit.ai/', B).replace(/^http:\/\/localhost:\d+\//, B)); await Bb.pg.waitForSelector('#send-now, #send-paste', { timeout: 20000 })
    check(!(await Bb.pg.evaluate(() => location.hash)) && (await Bb.pg.evaluate(() => localStorage.getItem('sgit.inbox.link'))) === codeA, 'the send page keeps the link in this browser and takes it out of the address')
    check((await Bb.text('#send-vault')).includes(readerId) && (await Bb.text('#send-vault')).includes(R.fingerprint) && /change\(s\)/.test(await Bb.text('#send-pending')), `it says which vault, which key, and what is only here: ${(await Bb.text('#send-pending')).trim()}`)
    await Bb.pg.fill('#send-label', 'iPhone, in WhatsApp'); await Bb.pg.click('#send-now'); await Bb.until('Sent:|Not sent', 60000)
    await shot(Bb.pg, '049-sent.png', '#send-mount')
    check(/^Sent: \d+ read\(s\).*1 note\(s\).*encrypted to sha256:/.test((await Bb.text('#send-sent')).trim()) && mock.pending(readerId) === 1, `Send: ${(await Bb.text('#send-sent')).trim().slice(0, 100)}`)
    const pendB2 = await Bb.pg.evaluate(async () => (await import('/assets/vault-pane/pending.js')).pending())
    check(pendB2.count === 0 && /nothing new since the last send/.test(await Bb.text('#send-pending')), 'after the send, nothing is counted as only in this browser; the records stay')
    const laneText = [...mock.lanes.values()].flatMap(l => [...l.pending.values()].map(f => f.payload)).join('\n')
    check(!laneText.includes('passkey') && !Buffer.from(laneText, 'base64').toString().includes(deviceB) && !laneText.includes('iPhone'), 'what reached the lane is ciphertext: no note, no device, no label')
    // a second note, sent from the strip above the pane, on any page
    await Bb.pg.goto(B + 'articles/sixteen-notes-i-did-not-want-to-lose.html'); await Bb.pg.waitForSelector('.vault-btn', { timeout: 20000 })
    await Bb.openPane('page'); await Bb.pg.click('#note-follow-up'); await Bb.pg.waitForTimeout(400)
    await Bb.pg.waitForSelector('#vault-inbox-send:not([hidden])', { timeout: 10000 })
    await Bb.pg.click('#vault-inbox-send'); await Bb.until('Sent to your vault’s inbox|Not sent', 60000)
    check(/Sent to your vault’s inbox/.test(await Bb.text('#vault-pending-out')) && mock.pending(readerId) === 2, 'a browser that holds the link and no passkey gets Send to my vault in the strip above the pane, on any page')
    check(Bb.seen.every(x => /^POST \/api\/vault\/append\/write\//.test(x) || /^GET \/api\/vault\/read\//.test(x)) && Bb.seen.filter(x => /append\/write/.test(x)).length === 2 && !Bb.seen.some(x => /configure|list|fetch|mark-processed|batch|PUT/.test(x)), `B only ever wrote to the lane (${Bb.seen.filter(x => /append/.test(x)).length} append call(s), no list, fetch, configure or vault write)`)
    const stB = await Bb.storage()
    check(stB.includes(codeA) && !stB.includes(R.enum_key) && !stB.includes(R.private.slice(20, 80)) && !/sgit_private/.test(stB), 'B keeps the link (a write-only address and a public key) and nothing else of the vault’s')

    // ---- three bad messages beside them
    const lB = I.parseLink(codeA)
    const s1 = await I.seal(I.unb64(other.public), JSON.stringify(I.message(fileB, other.fingerprint)))
    const s2 = await I.seal(lB.spki, JSON.stringify(I.message(fileB, R.fingerprint))); const e2 = JSON.parse(atob(atob(s2.payload))); const c2 = I.unb64(e2.c); c2[3] ^= 1; e2.c = I.b64(c2)
    const s3 = await I.seal(lB.spki, JSON.stringify({ kind: 'something-else/v1', to: R.fingerprint, file: fileB }))
    const codes = [await appendTo(readerId, R.token, s1.payload), await appendTo(readerId, R.token, btoa(btoa(JSON.stringify(e2)))), await appendTo(readerId, R.token, s3.payload)]
    check(codes.every(x => x === 200) && mock.pending(readerId) === 5, 'three bad messages appended with the same token: sealed to another key, changed on the way, the wrong kind')
    check((await appendTo(readerId, 'f'.repeat(32), s3.payload)) === 404 && (await appendTo(readerId, 'not-hex', s3.payload)) === 400, 'a token the lane does not know is refused (404), and one that is not hex (400)')

    // ---- A: what is waiting, refused or brought in
    await A.pg.click('#vault-inbox-check'); await A.pg.waitForSelector('#vault-inbox-count', { timeout: 60000 })
    check(/5 message\(s\) waiting in the lane: 2 from your other browsers, 3 refused/.test(await A.text('#vault-inbox-count')), `A sees what is waiting: ${(await A.text('#vault-inbox-count')).trim()}`)
    const items = await A.pg.evaluate(() => [...document.querySelectorAll('#vault-inbox-list li')].map(li => ({ cls: li.className, dev: li.dataset.device || '', t: li.textContent })))
    const refused = items.filter(x => x.cls === 'refused').map(x => x.t).join(' ')
    await shot(A.pg, '049-waiting.png', '#vault-inbox-waiting')
    check(/not sealed to this inbox/.test(refused) && /changed on the way/.test(refused) && /not a newsroom inbox message/.test(refused), 'the three are refused, each with its reason')
    check(items.filter(x => x.dev === deviceB).length === 2 && items.filter(x => x.dev === deviceB).every(x => /iPhone, in WhatsApp/.test(x.t) && /note\(s\)/.test(x.t)), 'B’s two are listed with the name B gave itself, when they were sent and what they carry, before anything is brought in')
    await A.pg.click('#vault-inbox-rotate'); await A.pg.waitForTimeout(300)
    check(!!(await A.pg.$('#vault-inbox-rotate-wait')), 'a new link waits until what is in the lane is brought in or discarded')
    await A.pg.click('#vault-inbox-take')
    await A.pg.waitForSelector('#vault-merged', { timeout: 120000 })
    check(/Brought in: [1-9]\d* read\(s\).*2 note\(s\)/.test(await A.text('#vault-merged')), `Bring them in: ${(await A.text('#vault-merged')).trim().slice(0, 110)}`)
    const notesA = await A.pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.notes.v1') || '{"notes":[]}').notes)
    check(notesA.length === 2 && notesA.every(n => n.device === deviceB) && notesA.some(n => n.text === 'kept on a phone that cannot reach my passkey') && notesA.some(n => n.kind === 'follow-up'), 'B’s notes are in A now, with B as their author')
    await A.pg.waitForFunction(() => /iPhone, in WhatsApp/.test((document.getElementById('vault-across') || {}).textContent || ''), null, { timeout: 60000 })
    check(true, 'the reader vault has B’s device file: B is a row across the devices')
    await A.pg.waitForSelector('#vault-inbox-count, #vault-inbox-empty', { timeout: 60000 })
    check(mock.pending(readerId) === 3 && /3 message\(s\) waiting in the lane: 0 from your other browsers, 3 refused/.test(await A.text('#vault-inbox-waiting')), 'B’s two are marked processed; the three refused are still listed, not brought in')
    await A.pg.click('#vault-inbox-discard'); await A.pg.waitForSelector('#vault-inbox-empty', { timeout: 60000 })
    check(mock.pending(readerId) === 0, 'Discard takes them out of the lane, unread into anything')

    // ---- a new link; the old one stops
    await A.pg.click('#vault-inbox-rotate'); await A.until('A new link is made|No new link', 60000)
    const code2 = await A.pg.evaluate(() => document.getElementById('vault-inbox-code').dataset.code)
    check(!!(await A.pg.$('#vault-inbox-rotated')) && code2 !== codeA && I.parseLink(code2).token !== R.token && (await I.fingerprint(I.parseLink(code2).spki)) === R.fingerprint, 'Make a new link: a new token, the same key')
    await Bb.pg.goto(B + 'vault/send.html'); await Bb.pg.waitForSelector('#send-now', { timeout: 20000 }); await Bb.pg.click('#send-now'); await Bb.until('Sent:|Not sent', 60000)
    check(/Not sent: the vault server answered 404/.test(await Bb.text('#send-failed')) && /Nothing was lost/.test(await Bb.text('#send-failed')), 'the old link can no longer write: B is told, and loses nothing')
    check((await appendTo(readerId, I.parseLink(code2).token, s3.payload)) === 200, 'the new link writes')
    await A.openPane('keys'); await A.pg.waitForSelector('#keys-inbox', { timeout: 30000 })
    check((await A.text('#keys-inbox')).includes(R.fingerprint), 'the Keys tab names the inbox and its key')
    const stA = await A.storage()
    check(!stA.includes(R.enum_key) && !stA.includes(R.private.slice(20, 80)), 'A keeps neither the private key nor the enum key in local or session storage')
    await Bb.pg.click('#send-forget'); await Bb.pg.waitForTimeout(200)
    check(!(await Bb.pg.evaluate(() => localStorage.getItem('sgit.inbox.link'))) && !!(await Bb.pg.$('#send-paste')), 'Forget the link: B holds no link, and the page asks for one')
    await Bb.pg.fill('#send-paste', 'not a link'); await Bb.pg.click('#send-use'); await Bb.pg.waitForTimeout(200)
    check(!!(await Bb.pg.$('#send-bad')), 'something pasted that is not a link is refused')
    // a phone
    const P = await browserCtx('P', { passkey: false, width: 390, height: 844 })
    await P.pg.goto(B + 'vault/send.html#' + code2); await P.pg.waitForSelector('#send-now', { timeout: 20000 })
    check((await P.pg.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'the send page at phone width: nothing scrolls sideways')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
    await mock.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL INBOX CHECKS PASS')
process.exit(failed ? 1 : 0)
