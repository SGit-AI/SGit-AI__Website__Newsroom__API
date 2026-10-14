#!/usr/bin/env node
/* test_passkey.mjs: the passkey lab in Chromium, with a virtual authenticator that has PRF.
 *
 *   node admin/build/test_passkey.mjs
 *
 * Drives passkey/index.html as a reader would: the capabilities card, making a passkey (prf.enabled), getting the
 * PRF bytes twice (the same bytes), the door derived from them (an 8-character id, two PBKDF2 keys), the recovery
 * code round trip, the test vectors (the browser agrees with sgit's Python on every value), and card 6 against the
 * mock of the vault API (admin/build/vault-mock.mjs), to which the page's calls to dev.send.sgraph.ai are
 * forwarded: an unknown door says "no door here for this path yet"; the account is created as three real vaults;
 * unlock opens them; the recovery code is added as a second door; a note is written and read back. Also: the page
 * stores nothing but the passkey's id and the device's clone branch, keeps the access key and every vault key out
 * of storage, sends only ciphertext, never sends X-API-Key, and makes no request to any host but its own and the
 * (mocked) vault server.
 *
 * WebAuthn needs a secure context or localhost, so the page is served as http://localhost, not 127.0.0.1. The
 * virtual authenticator comes from Chromium's WebAuthn CDP domain; PRF needs Chromium 128 or later. Skips (exit 0)
 * when Playwright or Chromium is not available.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { startMock } from './vault-mock.mjs'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
needsChromium('the passkey lab (a virtual authenticator over CDP)')
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP: playwright is not installed'); process.exit(0) }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.tpl': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }
const server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://localhost:${server.address().port}/`
let browser
browser = await launch()
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: CLIPBOARD }); await routeApi(ctx)
const pg = await ctx.newPage()
const errors = [], hosts = new Set()
pg.on('pageerror', e => errors.push(e.message))
pg.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
pg.on('request', r => hosts.add(new URL(r.url()).host))
const wait = ms => pg.waitForTimeout(ms)
const text = id => pg.evaluate(id => (document.getElementById(id) || {}).textContent || '', id)
const kv = async (id, key) => pg.evaluate(([id, key]) => { const r = [...document.querySelectorAll(`#${id} .kv`)].find(x => x.querySelector('.k').textContent.startsWith(key)); return r ? r.querySelector('.v').textContent : null }, [id, key])

// the vault server: the page's calls to dev.send.sgraph.ai are forwarded to the mock of the vault API
const mock = await startMock()
const seen = []
await pg.route('https://dev.send.sgraph.ai/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method()
    seen.push(`${m} ${u.pathname}${req.headers()['x-api-key'] ? ' (with X-API-Key)' : ''}`)
    const headers = {}
    for (const [k, v] of Object.entries(req.headers())) if (!/^(host|origin|referer|content-length|connection|accept-encoding)$/i.test(k) && !k.startsWith(':')) headers[k] = v
    const data = req.postDataBuffer()
    const r = await fetch(mock.base + u.pathname + u.search, { method: m, headers, body: data && m !== 'GET' && m !== 'HEAD' ? data : undefined })
    const out = {}
    r.headers.forEach((v, k) => { if (!/^(content-length|transfer-encoding|connection)$/i.test(k)) out[k] = v })
    await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) })
})

const cdp = await ctx.newCDPSession(pg)
await cdp.send('WebAuthn.enable', { enableUI: false })
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } })
const vectors = JSON.parse(fs.readFileSync(path.join(API, 'passkey/vectors.json'), 'utf8'))

try {
    await pg.goto(B + 'passkey/'); await pg.waitForFunction(() => document.documentElement.getAttribute('data-lab') === 'ready', null, { timeout: 20000 })
    // 0
    check(/present/.test(await kv('poc0-out', 'WebAuthn')) && /yes/.test(await kv('poc0-out', 'Secure context')), 'card 0: WebAuthn present in a secure context (localhost)')
    // 5, which runs on load
    await pg.waitForFunction(() => /agree on every value|value differs/.test(document.getElementById('poc5-out').textContent), null, { timeout: 30000 })
    const t5 = await text('poc5-out')
    check(/agree on every value/.test(t5) && !/✗/.test(t5), 'card 5: the browser and sgit agree on every test vector (HKDF, PBKDF2, file ids, deterministic AES-GCM, object id)')
    check((await kv('poc5-out', 'vault_id') || '').includes(vectors.vault_id), `card 5: the vector's door id is ${vectors.vault_id}`)
    // 1
    await pg.click('#poc1-go'); await pg.waitForFunction(() => /prf\.enabled/.test(document.getElementById('poc1-out').textContent), null, { timeout: 20000 })
    check((await kv('poc1-out', 'prf.enabled')) === 'true', 'card 1: a passkey is made for this host with prf.enabled true')
    check(await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('sgit.passkey.lab')); return s && typeof s.id === 'string' && !('prfBytes' in s) && Object.keys(localStorage).every(k => k === 'sgit.passkey.lab' || k === 'sgit.device-branch' || k === 'sgit.device-label' || k === 'sgit.notes.v1' || k === 'sgit.vault.last-sync' || k.startsWith('sgit.meter')) }), 'card 1: the browser keeps the passkey id and nothing else from the lab (the pane keeps the device id)')
    check(await pg.evaluate(() => document.getElementById('poc1-ladder').hidden), 'card 1: the ladder is hidden when PRF is on')
    // 2, twice
    await pg.click('#poc2-go'); await pg.waitForFunction(() => /fingerprint/.test(document.getElementById('poc2-out').textContent), null, { timeout: 20000 })
    const fp1 = await text('poc2-mine')
    await pg.waitForFunction(() => /Door vault id/.test(document.getElementById('poc3-out').textContent), null, { timeout: 30000 })
    const id1 = await kv('poc3-out', 'Door vault id')
    await pg.click('#poc2-go'); await wait(1500); await pg.waitForFunction(() => /Door vault id/.test(document.getElementById('poc3-out').textContent), null, { timeout: 30000 })
    const fp2 = await text('poc2-mine'), id2 = await kv('poc3-out', 'Door vault id')
    check(/^[0-9a-f]{8}$/.test(fp1) && fp1 === fp2, `card 2: the same passkey gives the same PRF bytes twice (fingerprint ${fp1})`)
    check(/^(platform|cross-platform)\b/.test(await kv('poc2-out', 'Path') || ''), `card 2: the path that answered is shown (${await kv('poc2-out', 'Path')})`)
    await pg.evaluate(() => [...document.querySelectorAll('#poc2-out .secret button')].find(b => /Reveal the bytes/.test(b.textContent)).click())
    const revealed = (await kv('poc2-out', 'The 32 PRF bytes') || '').match(/[0-9a-f]{64}/)
    check(revealed && !revealed[0].startsWith(fp1) && /SHA-256 of the bytes/.test(await pg.evaluate(() => document.getElementById('poc2-out').textContent)), 'card 2: the fingerprint is a hash of the bytes, not a prefix of them')
    check(/^[a-z0-9]{8}$/.test(id1) && id1 === id2 && id1 !== vectors.vault_id, `card 3: the door id is 8 of [a-z0-9] and stable (${id1})`)
    const read = await kv('poc3-out', 'Read key'), write = await kv('poc3-out', 'Write key')
    check(/\(64 characters\)/.test(read) && /\(64 characters\)/.test(write) && /\d+ ms/.test(read), 'card 3: read and write keys are 32 bytes each, hidden behind a reveal, with the PBKDF2 time shown')
    await pg.evaluate(() => [...document.querySelectorAll('#poc3-out .secret button')].find(b => /Reveal the key/.test(b.textContent)).click())
    const key = await kv('poc3-out', 'The sgit vault key')
    check(new RegExp(`^sgit_private_vault_[0-9a-f]{64}:${id1}`).test(key), 'card 3: the vault key is in sgit\'s format, passphrase:id')
    check(/sgit_public_read_[0-9a-f]{64}:[a-z0-9]{8}/.test(await kv('poc3-out', 'The published form')), 'card 3: the published read-key form is shown')
    // compare box
    await pg.fill('#poc2-other', fp1); await pg.click('#poc2-cmp-go')
    check(/The same/.test(await text('poc2-cmp-out')), 'card 2: comparing the fingerprint from another device says "the same"')
    await pg.fill('#poc2-other', '00000000'); await pg.click('#poc2-cmp-go')
    check(/Different/.test(await text('poc2-cmp-out')), 'card 2: a different fingerprint says so')
    // 4
    await pg.click('#poc4-go'); await wait(800)
    const code = await kv('poc4-out', 'Recovery code'), rdoor = await kv('poc4-out', 'Its door')
    check(/^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/.test(code) && /^[a-z0-9]{8}$/.test(rdoor) && rdoor !== id1, `card 4: a 26-character recovery code opens a different door (${rdoor})`)
    await pg.fill('#poc4-code', code.toLowerCase()); await pg.click('#poc4-check'); await wait(800)
    check((await text('poc4-check-out')).includes(rdoor), 'card 4: typing the code back gives the same door')
    // 6, real vaults against the mock of the vault API
    const out6 = re => pg.waitForFunction(re => new RegExp(re).test(document.getElementById('poc6-out').textContent), re, { timeout: 90000 })
    check(!(await pg.evaluate(() => document.getElementById('poc6').hidden)), 'card 6 appears once a door exists')
    check(await pg.evaluate(() => document.getElementById('poc6-create').disabled), 'card 6: create is disabled without an access key')
    await pg.click('#poc6-check'); await out6('No door here|A door exists|Error|failed')
    check(/No door here for this path yet/.test(await text('poc6-out')), 'card 6: an address with no door says "no door here for this path yet", not an error')
    await pg.fill('#poc6-access', mock.token); await pg.fill('#poc6-device', 'the test device'); await wait(100)
    check(!(await pg.evaluate(() => document.getElementById('poc6-create').disabled)), 'card 6: create is enabled with an access key')
    await pg.click('#poc6-create'); await out6('Three vaults exist|already exists|Error|failed')
    check(/Three vaults exist/.test(await text('poc6-out')) && mock.vaults().length === 3 && mock.vaults().includes(id1), `card 6: the account is three real vaults on the server, the door at its derived id ${id1}`)
    check(mock.files(id1).some(f => /^bare\/refs\/ref-pid-muw-/.test(f)) && mock.files(id1).some(f => /^bare\/indexes\/idx-pid-muw-/.test(f)) && mock.files(id1).filter(f => f.startsWith('bare/data/obj-cas-imm-')).length >= 5, 'card 6: the door has a named ref, a branch index and content-addressed objects, so sgit can clone it')
    const everything = [...mock.store.values()].map(b => b.toString('latin1')).join('\n')
    check(!/sgit_private|master-key|"kind"|the test device|reader\.json/.test(everything), 'card 6: what reached the server is ciphertext: no key, no record, no device label in the clear')
    check(!seen.some(s => /X-API-Key/.test(s)) && !mock.log.some(l => /not allowed/.test(l)), 'card 6: the page never sent X-API-Key, so no preflight was refused')
    await pg.click('#poc6-unlock'); await out6('Unlocked in|No door here|Error|failed')
    check(/Unlocked in/.test(await text('poc6-out')) && /the test device/.test(await kv('poc6-out', 'Where it came from') || '') && /\([a-z0-9]{8}|passkey/.test(await kv('poc6-out', 'Doors in the master') || ''), 'card 6: unlock opens the door, the master and the reader vault, with where the door came from and the list of doors')
    await pg.click('#poc6-add'); await out6('second door|already exists|Error|failed')
    check(/A second door, [a-z0-9]{8}, holds the same master key/.test(await text('poc6-out')) && mock.vaults().length === 4 && mock.vaults().includes(rdoor), `card 6: the recovery code's door ${rdoor} is added while unlocked, with no key typed or pasted`)
    await pg.fill('#poc6-note', 'hello from the lab test'); await pg.click('#poc6-write'); await out6('read back from a fresh open|Error|failed')
    check((await text('poc6-readback')) === 'hello from the lab test', 'card 6: a note is written into the reader vault as one commit, published, and read back from a fresh open')
    check(await pg.evaluate(() => Object.keys(localStorage).every(k => k === 'sgit.passkey.lab' || k === 'sgit.device-branch' || k === 'sgit.device-label' || k === 'sgit.notes.v1' || k === 'sgit.vault.last-sync' || k.startsWith('sgit.meter')) && ![...Object.values(localStorage), ...Object.values(sessionStorage)].some(v => /mock-|sgit_private|:[a-z0-9]{8}"?$/.test(v))), 'the access key and the vault keys are not in storage; the lab keeps its passkey id and the device\'s clone branch')
    const puts = seen.filter(s => s.startsWith('PUT '))
    check(seen.some(s => /^POST \/api\/vault\/batch\//.test(s)) && seen.some(s => /^GET \/api\/vault\/read\//.test(s)) && puts.length > 0 && puts.every(s => /\/bare\/indexes\/idx-pid-muw-/.test(s)), `the calls the server saw: ${[...new Set(seen.map(s => s.split(' ')[0] + ' ' + s.split('/').slice(1, 4).join('/')))].join(', ')} (every commit one batch; the only single PUTs are the branch index on publish, as the library writes it)`)
    const others = [...hosts].filter(h => !h.startsWith('localhost') && h !== API_HOSTNAME && h !== 'dev.send.sgraph.ai')
    check(others.length === 0, `no request to any other host${others.length ? ': ' + others.join(', ') : ''}`)
    // phone width
    const mCtx = await routeApi(await browser.newContext({ viewport: { width: 390, height: 800 } })); const m = await mCtx.newPage()
    await m.goto(B + 'passkey/'); await m.waitForTimeout(1500)
    check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at 390px')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
    await mock.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSKEY LAB CHECKS PASS')
process.exit(failed ? 1 : 0)
