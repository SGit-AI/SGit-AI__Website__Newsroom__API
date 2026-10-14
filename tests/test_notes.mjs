#!/usr/bin/env node
/* test_notes.mjs: the feedback loop in Chromium, against the mock of the vault API (admin/build/vault-mock.mjs).
 *
 *   export NODE_PATH=$(npm root -g); node admin/build/test_notes.mjs
 *
 * A reader on an article: one tap keeps a note with the phrase they had selected and the article's number; words
 * attach to it; a second note with words; the notes survive a reload; one is removed. On the wire (read live from
 * its vault; skipped with a line when the vault cannot be reached): a decision at a story folds it and is a note
 * with the story's id. Then the vault: the account made with a passkey, Update carries the notes, Send makes the
 * lane (a fifth vault), writes one file per note, shows the lane's read key, marks the notes sent. The Keys tab
 * lists every vault with a key behind Reveal. The sgit CLI clones the lane with the read key alone and reads the
 * notes, and admin/build/lane.py prints the digest: the newsroom's end of the loop. A second device with the same
 * passkey brings the first one's notes in, tagged, and its own update carries none of them. Hygiene as in the pane
 * test. Requests to dev.send.sgraph.ai go to the mock, except reads of objects the mock does not have, which go
 * on to the live server (the wire's vault).
 */
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync, spawn, spawnSync } from 'child_process'
import { startMock } from './vault-mock.mjs'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
needsChromium('the notes loop (a virtual authenticator over CDP)')
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP: playwright is not installed'); process.exit(0) }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.txt': 'text/plain', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }
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
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const runAsync = (cmd, a, opts = {}) => new Promise(resolve => {
    const p = spawn(cmd, a, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    p.stdout.on('data', d => { stdout += d }); p.stderr.on('data', d => { stderr += d })
    p.on('close', status => resolve({ status, stdout, stderr })); p.on('error', e => resolve({ status: -1, stdout, stderr: String(e) }))
    if (opts.input) p.stdin.write(opts.input)
    p.stdin.end()
})
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
    if ((m === 'GET' || m === 'HEAD') && r.status === 404) return route.continue()        // not the mock's: the wire's vault, live
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
const notes = () => pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.notes.v1') || '{"notes":[]}').notes)
const openPane = async tab => { if (!(await pg.evaluate(() => document.documentElement.classList.contains('vault-open')))) await pg.click('.vault-btn'); await wait(300); if (tab) { await pg.click(`#vault-tab-${tab}`); await wait(200) } }
const selectIn = sel => pg.evaluate(sel => { const el = document.querySelector(sel); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString().trim() }, sel)

try {
    // ---- A. notes on an article, no vault
    await pg.goto(B + 'articles/the-site-is-an-inbox.html'); await pg.waitForSelector('.vault-btn', { timeout: 20000 })
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(900); await pg.evaluate(() => window.scrollTo(0, 0)); await wait(300)   // the meter records the read
    const phrase = await selectIn('main p:not(.small)')
    await openPane()
    check(await pg.evaluate(() => document.getElementById('vault-tab-page').getAttribute('aria-selected') === 'true' && !document.getElementById('vault-sec-page').hidden), 'the pane opens on This page')
    await wait(300)
    check(/Selected:/.test(await text('#note-sel')), 'the phrase selected on the page is shown in the pane')
    await pg.click('#note-wrong'); await wait(200)
    let n = await notes()
    check(n.length === 1 && n[0].kind === 'wrong' && n[0].n === 82 && n[0].path === '/articles/the-site-is-an-inbox.html' && n[0].quote.length > 20 && phrase.startsWith(n[0].quote.slice(0, 20)) && n[0].persona === 'me' && !n[0].text, `one tap keeps a note: wrong, article No. ${n[0] && n[0].n}, with the selected phrase (${n[0] && n[0].quote.length} characters)`)
    check((await pg.evaluate(() => document.querySelectorAll('#notes-here li.note[data-kind=wrong]').length)) === 1 && (await text('#vault-tab-page-n')) === '1', 'it is listed under Kept on this page and the tab counts it')
    await pg.fill('#note-words', 'the second paragraph contradicts the first'); await pg.click('#note-keep'); await wait(200)
    n = await notes()
    check(n.length === 1 && n[0].text === 'the second paragraph contradicts the first', 'words typed after the tap attach to that note')
    await pg.fill('#note-words', 'a row of modes under the title'); await pg.click('#note-idea'); await wait(200)
    n = await notes()
    check(n.length === 2 && n[0].kind === 'idea' && n[0].text === 'a row of modes under the title' && n[0].quote === '', 'a tap with words typed first keeps them together; nothing selected, no quote')
    await pg.reload(); await pg.waitForSelector('.vault-btn', { timeout: 20000 }); await openPane()
    check((await notes()).length === 2 && (await text('#vault-tab-page-n')) === '2', 'the notes are in local storage: still there after a reload')
    await pg.click('#notes-here li.note[data-kind=idea] .x'); await wait(200)
    check((await notes()).length === 1 && (await pg.evaluate(() => document.querySelectorAll('#notes-here li.note').length)) === 1, 'remove takes a note out of this browser')
    const wrongId = (await notes())[0].id
    // the three steps, and what the browser knows about the page (007, 005)
    check(/Enable the vault/.test(await text('#vault-steps')) && (await pg.evaluate(() => (document.querySelector('#vault-steps li.next .n') || {}).textContent)) === '1', 'the three steps are shown, with Enable the vault as the next one')
    check(/Read once|Read \d+ times/.test(await text('#page-known')) && /you (read|glanced|opened)/.test(await text('#page-known')), `what the browser knows about the page: ${(await text('#page-known')).trim().slice(0, 70)}`)
    // Done: the decision at the page, and the Reading tab (004, 006)
    await pg.click('#note-done'); await wait(200)
    check(/Done/.test(await text('#page-known')) && (await notes())[0].kind === 'done', 'Done is a note, and the page shows it as its decision')
    await pg.click('#vault-tab-reading'); await wait(300)
    const listed = p => pg.evaluate(p => { const li = [...document.querySelectorAll('#reading-list li[data-path]')].find(li => li.dataset.path === p); return li ? { done: li.classList.contains('done-page'), text: li.textContent } : null }, p)
    check(!(await listed('/articles/the-site-is-an-inbox.html')) && /1 marked done/.test(await text('#reading-count')), 'the Reading tab folds the page marked done away and counts it')
    await pg.click('#reading-show-done'); await wait(200)
    const li = await listed('/articles/the-site-is-an-inbox.html')
    check(!!li && li.done && /Done/.test(li.text) && /you (read|glanced|opened)/.test(li.text), 'showing done pages lists it, marked Done, with how far it was read')
    await pg.click('#vault-tab-page'); await wait(100); await pg.click('#notes-here li.note[data-kind=done] .x'); await wait(200)
    check(!(await notes()).some(n => n.kind === 'done') && !/Done/.test(await text('#page-known')), 'removing the Done note gives the page back')
    await pg.click('#vault-tab-reading'); await wait(200)
    check(!!(await listed('/articles/the-site-is-an-inbox.html')) && !(await listed('/articles/the-site-is-an-inbox.html')).done, 'the Reading tab lists it again')
    await pg.click('#reading-show-done'); await wait(200)                                    // back to the default: done pages folded
    await pg.click('#reading-list li[data-path="/articles/the-site-is-an-inbox.html"] .mark'); await wait(200)
    check((await notes())[0].kind === 'done' && !(await listed('/articles/the-site-is-an-inbox.html')), 'Done from the Reading tab folds the page away')
    await pg.click('#vault-tab-page'); await wait(100); await pg.click('#notes-here li.note[data-kind=done] .x'); await wait(200)
    // the pane stays open from page to page (001)
    await pg.goto(B + 'articles/the-vault-is-live.html'); await pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await wait(600)
    check(await pg.evaluate(() => document.documentElement.classList.contains('vault-open') && document.getElementById('vault-tab-page').getAttribute('aria-selected') === 'true'), 'the pane stays open on the next page, on the same tab')
    check(/Not read in this browser/.test(await text('#page-known')) && (await pg.evaluate(() => document.querySelectorAll('#notes-here li.note').length)) === 0, 'the next page shows its own record: not read here, no notes')
    await pg.click('#sgit-vault-pane .close'); await pg.goto(B + 'articles/the-site-is-an-inbox.html'); await pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await wait(400)
    check(!(await pg.evaluate(() => document.documentElement.classList.contains('vault-open'))), 'Close keeps it closed on the next page')

    // ---- B. the wire, read as an inbox (023, 024, 025, 027)
    const wireReady = () => pg.waitForFunction(() => document.documentElement.getAttribute('data-wire') === 'ready' || document.querySelector('.wire-err'), null, { timeout: 90000 })
    const filterCount = k => pg.evaluate(k => { const b = document.querySelector(`#wire-inbox .filters button[data-filter="${k}"]`); const m = b && /\((\d+)\)/.exec(b.textContent); return m ? Number(m[1]) : -1 }, k)
    const badge = () => pg.evaluate(() => { const b = document.querySelector('.vault-btn .pend'); return b && !b.hidden ? Number(b.textContent) : 0 })
    await pg.goto(B + 'wire/'); await wireReady()
    let storyId = null
    if (await pg.$('.wire-err')) {
        console.log('     the wire\'s vault could not be reached from here; the inbox is not checked in this run')
    } else {
        const total = await pg.evaluate(() => document.querySelectorAll('article.story').length)
        check(/first visit to the wire/.test(await text('#wire-since')) && new RegExp(`${total} new stories`).test(await text('#wire-since')), `a first visit: every story is new (${(await text('#wire-since')).trim().slice(0, 80)})`)
        check((await filterCount('inbox')) === total && (await filterCount('new')) === total && (await filterCount('done')) === 0 && (await filterCount('all')) === total, `the filters count the inbox, new, done and everything (${total})`)
        check((await pg.evaluate(() => document.querySelectorAll('article.story .flag.new').length)) === total, 'every story carries a New flag')
        check(/release notes|Added:|·/.test(await text('#wire-releases')), `the bar says what changed in the vault: ${(await text('#wire-releases')).trim().slice(0, 70)}`)
        check((await pg.evaluate(() => document.querySelectorAll('.story .decide .chip[data-kind]').length)) >= 6 * 2 && !!(await pg.$('.story .decide .chip[data-kind=follow-up]')), 'every story carries six decisions, Follow up among them')
        storyId = await pg.evaluate(() => document.querySelector('article.story').id)
        await pg.click(`#${storyId} .decide .chip[data-kind=not-for-me]`); await wait(300)
        n = await notes()
        check(n.length === 2 && n[0].kind === 'not-for-me' && n[0].story === storyId && n[0].path === '/wire/' && n[0].n === null, `not for me at a story is a note with the story's id (${storyId})`)
        check(!(await pg.$(`#${storyId}`)) && (await filterCount('inbox')) === total - 1 && /Not for me/.test(await text('#wire-kept')) && !!(await pg.$('#wire-kept .undo')), 'the decided story leaves the inbox, and the bar says so with undo')
        check((await badge()) >= 2 && /only in this browser/.test(await text('#wire-pending')) && !!(await pg.$('#wire-update')), `the Vault button counts what only this browser holds (${await badge()}) and the bar offers Update the vault`)
        await pg.click('#wire-inbox .filters button[data-filter="all"]'); await wait(300)
        check(await pg.evaluate(id => { const s = document.getElementById(id); return !!s && s.classList.contains('decided') && !!s.querySelector('.decide .undo') && /Not for me/.test(s.querySelector('.decide').textContent) }, storyId), 'in Everything the decided story is folded to its headline and the decision, with undo')
        await pg.click('#wire-inbox .filters button[data-filter="inbox"]'); await wait(200)
        await openPane()
        check(await pg.evaluate(id => [...document.querySelectorAll('#notes-here li.note')].some(li => li.textContent.includes(`story ${id}`)), storyId), 'the pane lists it under this page, by story')
        check(!(await pg.$eval('#vault-pending', e => e.hidden)) && /only in this browser/.test(await text('#vault-pending-msg')), 'the pane shows the strip of what only this browser holds')
        await pg.click('#notes-all li.note[data-kind=not-for-me] .x'); await wait(300)
        check(!!(await pg.$(`#${storyId}`)) && (await filterCount('inbox')) === total && (await notes()).length === 1, 'removing the note from the pane puts the story back in the inbox')
        await pg.click(`#${storyId} .decide .chip[data-kind=not-for-me]`); await wait(300)
        // a new visit: nothing is new; the lens is remembered
        await pg.evaluate(() => sessionStorage.removeItem('sgit.wire.visit')); await pg.reload(); await wireReady(); await wait(300)
        check(/Since your last visit/.test(await text('#wire-since')) && /\b0 new stories/.test(await text('#wire-since')) && (await filterCount('new')) === 0 && (await filterCount('inbox')) === total - 1, 'a new visit: the stories seen before are not new, the decision holds')
        const named = await pg.evaluate(() => { const b = [...document.querySelectorAll('.lens button')].find(b => /personal brief|Dinis/.test(b.textContent)); return b ? b.textContent : '' })
        if (named) {
            await pg.evaluate(t => [...document.querySelectorAll('.lens button')].find(b => b.textContent === t).click(), named); await wait(1500)
            await pg.goto(B + 'wire/'); await wireReady(); await wait(1200)
            check((await pg.evaluate(() => (document.querySelector('.lens button[aria-pressed=true]') || {}).textContent)) === named, `the lens chosen is remembered (${named.split(',')[0]})`)
            await pg.evaluate(() => [...document.querySelectorAll('.lens button')].find(b => b.textContent === 'Everyone').click()); await wait(300)
        }
    }
    const expected = storyId ? 2 : 1

    // ---- C. the vault: enable, create the account, Update carries the notes
    await pg.goto(B + 'articles/the-site-is-an-inbox.html'); await pg.waitForSelector('.vault-btn', { timeout: 20000 })
    await openPane('vault')
    await pg.click('#vault-enable'); await until('No passkey answered|No door here|Opening')
    if (/No passkey answered/.test(await paneText())) { await pg.click('#sgit-vault-pane button:has-text("Make a passkey for this site")'); await until('A passkey was made'); await pg.click('#vault-enable') }
    await until('No door here for this path yet')
    await pg.fill('#sgit-vault-pane input[type=password]', mock.token)
    await pg.click('#vault-create'); await until('Your recovery code|was not|Error', 120000)
    check(mock.vaults().length === 4, `the account: four vaults on the server (${mock.vaults().length})`)
    const deviceA = await pg.evaluate(() => localStorage.getItem('sgit.device-branch'))
    await pg.click('#vault-sync'); await until('Updated:|not updated', 120000)
    check(new RegExp(`${expected} note\\(s\\)(,| from)`).test(await text('#vault-synced')), `Update the vault carries ${expected} note(s) in this device's file (${(await text('#vault-synced')).trim()})`)
    await until('1 device\\(s\\)')
    const notesCol = await pg.evaluate(() => { const r = [...document.querySelectorAll('#vault-across tr.total td')]; return r.length ? r[4].textContent.trim() : '' })
    check(notesCol === String(expected), `the table across devices counts the notes (${notesCol})`)
    check(/2.*Update the vault.*\(last 20/.test((await pg.evaluate(() => [...document.querySelectorAll('#vault-steps li')].map(li => li.className + ' ' + li.textContent).join(' | ')))) && (await pg.evaluate(() => (document.querySelector('#vault-steps li.next .n') || {}).textContent)) === '3', 'steps 1 and 2 are ticked, step 3 is next')

    // ---- the lab's early accounts: no access key in the master (003, 002)
    await pg.evaluate(async () => {
        const NV = await import('/assets/newsroom-vault.js')
        const rec = JSON.parse(sessionStorage.getItem('sgit.vault.session'))
        const sg = NV.client({ endpoint: 'https://dev.send.sgraph.ai', token: rec.token })
        const u = await NV.unlock({ sgSend: sg, door: rec.door, cloneBranch: 'nr-test-strip' })
        await NV.writeFile(u.master, '/.vault', 'access-token.json', JSON.stringify({ token: '' })); await NV.publish(u.master)
        sessionStorage.setItem('sgit.vault.session', JSON.stringify({ ...rec, token: '' }))
    })
    await pg.reload(); await pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await until('Across your devices|could not be opened', 90000)
    check(await pg.evaluate(() => document.documentElement.classList.contains('vault-open') && !!document.getElementById('vault-notoken') && document.getElementById('vault-sync').disabled), 'an account whose master holds no access key: the pane says so, offers to add it, and Update is off')
    await pg.click('#vault-tab-page'); await wait(200); await pg.click('#vault-send'); await wait(500)
    check(/holds no access key/.test(await text('#vault-send-out')) && !/null/.test(await text('#vault-sec-page')), 'Send says the master holds no access key, and prints no stray null')
    await pg.click('#vault-tab-vault'); await pg.fill('#vault-notoken input[type=password]', mock.token); await pg.click('#vault-add-token'); await until('is in the master now|refused', 90000)
    check(!!(await pg.$('#vault-token-added')) && !(await pg.evaluate(() => document.getElementById('vault-sync').disabled)), 'Add the access key writes it into the master, and Update is on again')

    // ---- D. Send to the newsroom: the lane
    await pg.click('#vault-tab-page'); await wait(300)
    check(!(await pg.evaluate(() => document.getElementById('vault-send').disabled)) && new RegExp(`${expected} not yet sent`).test(await text('#notes-count')), `${expected} note(s) not yet sent, and Send is live`)
    await pg.click('#vault-send'); await until('Sent:|Not sent', 180000)
    check(new RegExp(`Sent: ${expected} note\\(s\\) to the lane [a-z0-9]{4,24}, published`).test(await text('#vault-sent')) && /updated too/.test(await text('#vault-sent')), `Send: ${(await text('#vault-sent')).trim().slice(0, 90)}`)
    check(mock.vaults().length === 5, `the lane is a fifth vault on the server (${mock.vaults().length})`)
    const readKey = (await text('#vault-lane-key')).trim()
    check(/^sgit_public_read_[0-9a-f]{64}:[a-z0-9]{4,24}$/.test(readKey), 'the lane\'s read key is shown, in the form sgit clones with')
    const laneId = readKey.split(':')[1]
    n = await notes()
    check(n.filter(x => !x.device).every(x => x.sent && x.sent.lane === laneId) && (await pg.evaluate(() => document.getElementById('vault-send').disabled)) && /0 not yet sent/.test(await text('#notes-count')), 'the notes are marked sent to that lane and Send has nothing left')
    await pg.fill('#note-words', 'and a third thought'); await pg.click('#note-keep'); await wait(200)
    check(!(await pg.evaluate(() => document.getElementById('vault-send').disabled)), 'a new note makes Send live again')
    await pg.click('#vault-send'); await until('Sent: 1 note', 120000)
    check(mock.vaults().length === 5 && /Sent: 1 note\(s\) to the lane/.test(await text('#vault-sent')), 'a second send goes to the same lane')
    // a message to the newsroom, saved and sent in one press (034)
    check(await pg.evaluate(() => /Write to the newsroom/.test((document.getElementById('note-write') || {}).textContent || '') && !/Keep these words/.test(document.getElementById('sgit-vault-pane').textContent)), 'the message box is headed Write to the newsroom, and no button says Keep these words')
    const MSG = 'a question for the newsroom, saved and sent at once'
    await pg.fill('#note-words', MSG); await pg.click('#note-send')
    await pg.waitForFunction(m => { const n = JSON.parse(localStorage.getItem('sgit.notes.v1') || '{"notes":[]}').notes.find(x => x.text === m); return !!(n && n.sent && document.getElementById('vault-sent')) }, MSG, { timeout: 120000 })
    const msg = (await notes()).find(x => x.text === MSG)
    check(msg && msg.kind === 'note' && msg.sent.lane === laneId && /^Saved: Message on/.test(await text('#note-saved')) && /Sent: 1 note\(s\) to the lane/.test(await text('#vault-sent')), 'Save and send keeps the message and sends it to the same lane, in one press')
    const everything = [...mock.store.values()].map(b => b.toString('latin1')).join('\n')
    check(!/contradicts|the-site-is-an-inbox|not-for-me|sgit_public_read|sgit_private/.test(everything), 'what reached the server is ciphertext: no note, no page, no key in the clear')

    // ---- the Keys tab
    await pg.click('#vault-tab-keys'); await until('Your vaults')
    await wait(500)
    const keysText = await text('#vault-sec-keys')
    check(/This door/.test(keysText) && /Master/.test(keysText) && /Reader vault/.test(keysText) && /The lane/.test(keysText) && /Its read key/.test(keysText) && keysText.includes(readKey), 'the Keys tab lists this door, the master, the reader vault, the lane and its read key')
    check(/Door · recovery/.test(keysText), 'the recovery door is listed too')
    check(!/sgit_private/.test(keysText), 'no vault key is on screen until Reveal')
    await pg.click('#vault-sec-keys .secret button:has-text("Reveal")'); await wait(100)
    check(/sgit_private_vault_[a-z0-9]{64}:[a-z0-9]{4,24}/.test(await text('#vault-sec-keys')), 'Reveal shows a door\'s key in sgit\'s own form')
    check(await pg.evaluate(() => !Object.values(localStorage).some(v => /mock-|sgit_private|sgit_public_read/.test(v))), 'no key, read key or access key in local storage')

    // ---- E. the newsroom's end: sgit clones the lane with the read key, lane.py prints the digest
    const which = spawnSync('sgit', ['--version'], { encoding: 'utf8' })
    if (which.status !== 0) {
        console.log('SKIP: sgit is not installed (pip install sgit-ai==0.21.0), so the newsroom\'s end of the loop did not run')
    } else {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-lane-'))
        const env = { ...process.env, SGIT_DEFAULT_BASE_URL: mock.baseLocalhost, NEWSROOM_LANE_KEY: readKey }
        const laneDir = path.join(tmp, 'lane')
        const c1 = await runAsync('sgit', ['clone', '-', laneDir, '--base-url', mock.baseLocalhost], { cwd: tmp, input: readKey + '\n', env })
        const files = c1.status === 0 && fs.existsSync(path.join(laneDir, 'notes')) ? fs.readdirSync(path.join(laneDir, 'notes')).filter(f => f.endsWith('.json')) : []
        check(files.length === expected + 2 && fs.existsSync(path.join(laneDir, 'README.md')), `sgit clone with the read key alone reads the lane: ${files.length} note file(s) and the README${c1.status ? ': ' + (c1.stderr || c1.stdout).trim().split('\n').slice(-2).join(' | ') : ''}`)
        if (files.length) {
            const recs = files.map(f => JSON.parse(fs.readFileSync(path.join(laneDir, 'notes', f), 'utf8')))
            const w = recs.find(r => r.id === wrongId)
            check(w && w.kind === 'wrong' && w.n === 82 && w.text === 'the second paragraph contradicts the first' && w.quote.length > 20 && w.device === deviceA && w.sent_at, 'the wrong note arrives whole: kind, article number, words, quote, device, sent time')
            const wrote = fs.existsSync(path.join(laneDir, 'notes', `${wrongId}.json`))
            fs.writeFileSync(path.join(laneDir, 'reply.txt'), 'from the newsroom\n')
            const cm = await runAsync('sgit', ['commit', 'a reply'], { cwd: laneDir, env })
            const ps = await runAsync('sgit', ['--token', mock.token, 'push'], { cwd: laneDir, env })
            check(wrote && (cm.status !== 0 || ps.status !== 0), 'the read key cannot write: a push from the clone is refused')
        }
        const d1 = await runAsync('python3', [path.join(ROOT, 'admin/build/lane.py'), '--dir', path.join(tmp, 'lane2')], { cwd: tmp, env })
        check(d1.status === 0 && /cloned/.test(d1.stdout) && /No\. 82 · The site is an inbox/.test(d1.stdout) && /- Wrong ·/.test(d1.stdout) && /the second paragraph contradicts the first/.test(d1.stdout) && /## Messages \(\d+\)[\s\S]*a question for the newsroom/.test(d1.stdout) && (!storyId || new RegExp(`story ${storyId}`).test(d1.stdout)), `lane.py clones with the key from the environment and prints the digest by page${d1.status ? ': ' + (d1.stderr || d1.stdout).trim().split('\n').slice(-2).join(' | ') : ''}`)
        check(!d1.stdout.includes(readKey) && !d1.stderr.includes(readKey), 'lane.py never prints the key')
        const d2 = await runAsync('python3', [path.join(ROOT, 'admin/build/lane.py'), '--dir', path.join(tmp, 'lane2'), '--json'], { cwd: tmp, env })
        let parsed = []; try { parsed = JSON.parse(d2.stdout.slice(d2.stdout.indexOf('['))) } catch (e) { parsed = [] }
        check(d2.status === 0 && parsed.length === expected + 2 && parsed[0].at >= parsed[parsed.length - 1].at, `lane.py --json pulls and gives the notes newest first (${parsed.length})`)
        const d3 = await runAsync('python3', [path.join(ROOT, 'admin/build/lane.py'), '--dir', path.join(tmp, 'lane2')], { cwd: tmp, env: { ...env, NEWSROOM_LANE_KEY: 'sgit_private_vault_' + 'x'.repeat(64) + ':abcd1234' } })
        check(d3.status !== 0 && /not a public read key/.test(d3.stderr), 'lane.py refuses a vault key: the newsroom is not to hold write access')
        fs.rmSync(tmp, { recursive: true, force: true })
    }

    // ---- F. device B: the same passkey, a cleared browser, brings A's notes in
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await pg.goto(B + 'vault/'); await pg.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await wait(500)
    await pg.fill('#sgit-vault-pane input[type=text]', 'device B'); await pg.press('#sgit-vault-pane input[type=text]', 'Tab')
    await pg.click('#vault-enable'); await until('Across your devices|No door here|Error', 120000)
    await until('All, 1 device')
    await pg.click('#vault-merge'); await pg.waitForSelector('#vault-merged', { timeout: 60000 })
    n = await notes()
    // a send rewrites A's device file too (009), so the vault holds every note A sent, marked sent
    check(new RegExp(`${expected + 2} note\\(s\\)`).test(await text('#vault-merged')) && n.length === expected + 2 && n.every(x => x.device === deviceA && x.sent), `device B: A's ${expected + 2} notes are here, tagged with A and marked sent (${(await text('#vault-merged')).trim().slice(0, 80)})`)
    await pg.click('#vault-tab-page'); await wait(300)
    check(await pg.evaluate(() => [...document.querySelectorAll('#notes-all li.note')].every(li => /from nr-/.test(li.textContent) && !li.querySelector('.x'))), 'device B lists them as from A, with nothing to remove')
    check(await pg.evaluate(() => document.getElementById('vault-send').disabled) && /0 not yet sent/.test(await text('#notes-count')), 'device B has nothing of its own to send: another device\'s notes are not re-sent')
    await pg.click('#vault-tab-vault'); await wait(200)
    await pg.click('#vault-sync'); await until('Updated:|not updated', 120000)
    check(/0 note\(s\) from device B/.test(await text('#vault-synced')), 'device B\'s update carries none of A\'s notes')
    await pg.click('#vault-tab-keys'); await until('Its read key')
    check((await text('#vault-sec-keys')).includes(readKey), 'device B sees the same lane and read key, from the master')

    // ---- the wire on device B: what A saw is not new here; Update the vault from the wire's bar (027, 028)
    await pg.goto(B + 'wire/'); await wireReady(); await wait(500)
    if (storyId && !(await pg.$('.wire-err'))) {
        check(/\b0 new stories/.test(await text('#wire-since')) && (await filterCount('new')) === 0, `device B: the stories A saw are not new here (${(await text('#wire-since')).trim().slice(0, 60)})`)
        check(!(await pg.$(`#${storyId}`)) && (await filterCount('inbox')) === (await filterCount('all')) - 1, 'device B: A\'s decision, brought in, keeps that story out of the inbox')
        const other = await pg.evaluate(() => document.querySelector('article.story').id)
        await pg.click(`#${other} .decide .chip[data-kind=follow-up]`); await wait(400)
        const pb = await badge(), pt = (await text('#wire-pending')).trim()
        check(pb >= 1 && /1 note/.test(pt) && /only in this browser/.test(pt), `device B: the decision is counted as only in this browser (${pb}: ${pt.slice(0, 90)})`)
        await pg.click('#wire-update'); await pg.waitForFunction(() => /in your vault \(last update/.test((document.getElementById('wire-pending') || {}).textContent || ''), null, { timeout: 120000 })
        check((await badge()) === 0 && /Everything you decided here is in your vault/.test(await text('#wire-pending')), 'Update the vault from the wire\'s bar: the count goes to zero')
        check(/Updated: \d+ read\(s\), \d+ top-up\(s\), \d+ persona\(s\), 1 note\(s\)/.test(await text('#vault-pending-out')), `the pane says what the update wrote: ${(await text('#vault-pending-out')).trim().slice(0, 90)}`)
    }

    // ---- hygiene
    check(!seen.some(s => /X-API-Key/.test(s)), 'the page never sent X-API-Key')
    const others = [...hosts].filter(h => !h.startsWith('localhost') && h !== API_HOSTNAME && h !== 'dev.send.sgraph.ai')
    check(others.length === 0, `no request to any other host${others.length ? ': ' + others.join(', ') : ''}`)
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 800 })
    const mErrors = []; m.on('pageerror', e => mErrors.push(e.message))
    await m.goto(B + 'articles/the-site-is-an-inbox.html#notes'); await m.waitForSelector('#sgit-vault-pane', { timeout: 20000 }); await m.waitForTimeout(800)
    check((await m.evaluate(() => document.documentElement.classList.contains('vault-open') && document.documentElement.scrollWidth <= 390 && !document.getElementById('vault-sec-page').hidden && !!document.getElementById('note-wrong'))) && mErrors.length === 0, `at phone width #notes opens the pane on This page with the chips drawn, and nothing scrolls sideways${mErrors.length ? ': ' + mErrors[0] : ''}`)
    check((await m.evaluate(() => { const k = document.getElementById('vault-sec-page'); return k.scrollWidth <= k.clientWidth + 1 })), 'the page tab fits the pane\'s width')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
    await mock.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL FEEDBACK LOOP CHECKS PASS')
process.exit(failed ? 1 : 0)
