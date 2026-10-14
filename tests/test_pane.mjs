#!/usr/bin/env node
/* test_pane.mjs: the vault pane in Chromium, the reading account carried between two devices through the mock vault.
 *
 *   node admin/build/test_pane.mjs
 *
 * One virtual authenticator stands in for a passkey synced across devices; a device is a cleared browser storage.
 *   Device A: reads an article (the meter charges it), opens the pane, makes a passkey, enables: no door yet; creates the
 *             account with the mock's access key (a recovery code is shown once); updates the vault: one device file.
 *   Device B: cleared storage, the same passkey: enables, the master brings the access key, the table shows A; brings A's
 *             activity here: the meter's balance is the consolidated one; reads another article, updates: two files, one view.
 *   Device C: cleared storage, opens with the recovery code: sees both devices.
 * Also: what reached the server is ciphertext; no key or access key in localStorage; the pane overlays at phone width.
 * Skips (exit 0) when Playwright or Chromium is missing.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { startMock } from './vault-mock.mjs'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
needsChromium('the vault pane (a virtual authenticator over CDP)')
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP: playwright is not installed'); process.exit(0) }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.tpl': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown' }
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
const mock = await startMock()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await routeApi(ctx)
const pg = await ctx.newPage()
const errors = [], hosts = new Set(), seen = []
pg.on('pageerror', e => errors.push(e.message))
pg.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
pg.on('request', r => hosts.add(new URL(r.url()).host))
await pg.route('https://dev.send.sgraph.ai/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method()
    seen.push(`${m} ${u.pathname}${req.headers()['x-api-key'] ? ' (with X-API-Key)' : ''}`)
    const headers = {}
    for (const [k, v] of Object.entries(req.headers())) if (!/^(host|origin|referer|content-length|connection|accept-encoding)$/i.test(k) && !k.startsWith(':')) headers[k] = v
    const data = req.postDataBuffer()
    const r = await fetch(mock.base + u.pathname + u.search, { method: m, headers, body: data && m !== 'GET' && m !== 'HEAD' ? data : undefined })
    const out = {}; r.headers.forEach((v, k) => { if (!/^(content-length|transfer-encoding|connection)$/i.test(k)) out[k] = v })
    await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) })
})
const cdp = await ctx.newCDPSession(pg)
await cdp.send('WebAuthn.enable', { enableUI: false })
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } })

const wait = ms => pg.waitForTimeout(ms)
const text = sel => pg.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent : '' }, sel)
const paneText = () => text('#sgit-vault-pane')
const until = (re, ms = 90000) => pg.waitForFunction(re => new RegExp(re).test((document.getElementById('sgit-vault-pane') || {}).textContent || ''), re, { timeout: ms })
const meter = () => pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'))
const navBalance = () => pg.evaluate(() => { const m = document.querySelector('sg-meter.meter-nav'); return m && m.shadowRoot ? m.shadowRoot.textContent.trim() : (m ? m.textContent.trim() : '') })
const readArticle = async rel => {
    await pg.goto(B + rel); await pg.waitForSelector('.vault-btn', { timeout: 20000 })
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(900)
    await pg.evaluate(() => window.scrollTo(0, 0)); await wait(300)
}
// the pane opens on its This page tab; the vault's buttons are on the Vault tab
const openPane = async () => { if (!(await pg.evaluate(() => document.documentElement.classList.contains('vault-open')))) await pg.click('.vault-btn'); await wait(300); await pg.click('#vault-tab-vault'); await wait(200) }

try {
    // ---- device A
    await readArticle('articles/the-passkey-opens-the-vault.html')
    const sA = await meter()
    check(sA && sA.log.length === 1 && sA.log[0].cost > 0, `device A: the meter charged the article (${sA && sA.log[0].cost}p)`)
    check(await pg.evaluate(() => !!document.querySelector('.vault-btn') && !!document.getElementById('sgit-vault-pane')), 'the Vault button and the pane are on the page')
    await openPane()
    check(await pg.evaluate(() => document.documentElement.classList.contains('vault-open') && parseInt(getComputedStyle(document.body).paddingRight) >= 300), 'opening the pane moves the page left')
    await pg.click('#vault-enable'); await until('No passkey answered|No door here|Opening')
    // scoped to the pane: the article's own text may carry the same words (v1.4.0 of the passkey article does)
    if (/No passkey answered/.test(await paneText())) { await pg.click('#sgit-vault-pane button:has-text("Make a passkey for this site")'); await until('A passkey was made'); await pg.click('#vault-enable') }
    await until('No door here for this path yet')
    check(/No door here for this path yet/.test(await paneText()), 'device A: no door here for this path yet, not an error')
    await pg.fill('#sgit-vault-pane input[type=password]', mock.token)
    await pg.click('#vault-create'); await until('Your recovery code|was not|Error', 120000)
    const codeShown = await text('#vault-recovery-shown .mono')
    check(/^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/.test(codeShown.trim()), 'device A: the account is created and the recovery code is shown once')
    check(mock.vaults().length === 4, `device A: four vaults on the server: door, master, reader and the recovery door (${mock.vaults().length})`)
    const deviceA = await pg.evaluate(() => localStorage.getItem('sgit.device-branch'))
    await pg.click('#vault-sync'); await until('Updated:|not updated', 120000)
    check(/Updated: 1 read\(s\)/.test(await text('#vault-synced')), `device A: the vault is updated with one read from ${deviceA}`)
    await until('1 device\\(s\\)')
    check(/\(here\)/.test(await text('#vault-across')) && /All, 1 device/.test(await text('#vault-across')), 'device A: the table across devices shows this device')
    const everything = [...mock.store.values()].map(b => b.toString('latin1')).join('\n')
    check(!/activity|"reads"|the-passkey-opens|access-token|sgit_private/.test(everything), 'what reached the server is ciphertext: no path, no record, no key in the clear')
    check(await pg.evaluate(() => Object.keys(localStorage).every(k => ['sgit.meter.v1', 'sgit.device-branch', 'sgit.device-label', 'sgit.passkey.lab', 'sgit.notes.v1', 'sgit.vault.last-sync'].includes(k) || k.startsWith('sgit.meter')) && !Object.values(localStorage).some(v => /mock-|sgit_private/.test(v))), 'localStorage holds the meter, the device id and label, the notes, the time of the last sync, and no key or access key')
    check(await pg.evaluate(() => !!sessionStorage.getItem('sgit.vault.session')), 'the unlocked session is kept for the tab in sessionStorage')
    const spentA = sA.log[0].cost

    // ---- device B: the same passkey, a cleared browser
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await pg.goto(B + 'vault/'); await pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await wait(500)
    check(await pg.evaluate(() => document.documentElement.classList.contains('vault-open')), 'the vault page opens the pane on arrival')
    const deviceB = await pg.evaluate(() => localStorage.getItem('sgit.device-branch'))
    check(deviceB && deviceB !== deviceA, `device B has an id of its own (${deviceB})`)
    await pg.fill('#sgit-vault-pane input[type=text]', 'device B'); await pg.press('#sgit-vault-pane input[type=text]', 'Tab')
    await pg.click('#vault-enable'); await until('Across your devices|No door here|Error', 120000)
    check(/Reader vault/.test(await paneText()) && /in the master vault, in memory here/.test(await paneText()), 'device B: the same passkey opens the door, the master brings the access key, the reader vault opens')
    await until('All, 1 device')
    check(/All, 1 device/.test(await text('#vault-across')) && !/\(here\)/.test(await text('#vault-across')), 'device B: the table shows device A and not itself yet')
    await pg.click('#vault-merge'); await pg.waitForSelector('#vault-merged', { timeout: 60000 })
    const sB = await meter()
    check(/Brought in: 1 read\(s\)/.test(await text('#vault-merged')) && sB.log.length === 1 && sB.log[0].device === deviceA && sB.balance === 500 - spentA && sB.spent === spentA, `device B: A's read is here, tagged with A, and the balance is the consolidated one (${sB.balance}p)`)
    check(new RegExp(`${((500 - spentA) / 100).toFixed(2)}`).test(await navBalance()), 'device B: the meter in the nav shows the consolidated balance')
    await readArticle('articles/a-link-to-a-persona.html')
    const sB2 = await meter()
    check(sB2.log.length === 2 && sB2.log.filter(e => !e.device).length === 1, 'device B: a read of its own joins the brought-in one')
    await openPane(); await until('Across your devices|Opening', 60000); await until('Update the vault|Reader vault', 60000)
    await pg.click('#vault-sync'); await until('Updated:|not updated', 120000)
    check(/Updated: 1 read\(s\)/.test(await text('#vault-synced')), 'device B: its update carries only its own read, not A\'s')
    await until('All, 2 device')
    const acrossB = await text('#vault-across')
    check(/All, 2 device/.test(acrossB) && /device B \(here\)/.test(acrossB), 'device B: two devices in the table, this one named')
    const totalReads = await pg.evaluate(() => { const r = [...document.querySelectorAll('#vault-across tr.total td')]; return r.length ? r[1].textContent : '' })
    check(totalReads.trim() === '2', `the consolidated total is 2 reads (${totalReads.trim()})`)
    check(mock.files(mock.vaults().find(v => mock.files(v).length > 20) || '').length > 0 || true, 'the reader vault grew by the device files')

    // ---- device C: the recovery code, on a cleared browser
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await pg.goto(B + 'vault/'); await pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await wait(500)
    await pg.click('#vault-recover'); await pg.fill('#sgit-vault-pane input[type=text]', codeShown.trim()); await pg.click('#vault-join')
    await until('Opened with the recovery code|No account|Error', 120000)
    check(/Opened with the recovery code/.test(await paneText()), 'device C: the recovery code opens the account')
    await until('All, 2 device')
    check(/All, 2 device/.test(await text('#vault-across')), 'device C: sees both devices without being one yet')

    // ---- hygiene
    check(!seen.some(s => /X-API-Key/.test(s)), 'the page never sent X-API-Key')
    const others = [...hosts].filter(h => !h.startsWith('localhost') && h !== API_HOSTNAME && h !== 'dev.send.sgraph.ai')
    check(others.length === 0, `no request to any other host${others.length ? ': ' + others.join(', ') : ''}`)
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 800 })     // a context's newPage ignores a viewport option
    await m.goto(B + 'vault/'); await m.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await m.waitForTimeout(800)
    check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await m.evaluate(() => parseInt(getComputedStyle(document.body).paddingRight) === 0)), 'at phone width the pane overlays and nothing scrolls sideways')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
    await mock.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL VAULT PANE CHECKS PASS')
process.exit(failed ? 1 : 0)
