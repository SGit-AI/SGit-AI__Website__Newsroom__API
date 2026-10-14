#!/usr/bin/env node
/* test_meter.mjs — SG Meter v1.4.0 in a real browser, against the built site.
 *
 *   node admin/build/test_meter.mjs
 *
 * Taken from sgit.ai's test of v1.3.1 and extended for what this site changed: no Pause and no Start
 * again on the account page, a stored "paused" flag cleared, and a persona arriving by a link
 * (/persona/<id>/, /persona/#<id>, the picker): added as a visitor, kept or removed, never charged.
 *
 * Serves the repo root on a local port, opens it in Chromium and drives the meter the way a
 * reader would: read by depth, decline, reload, go below zero, return from a payment, add a
 * persona, keep and reject articles, read as that persona, export and restore into a fresh
 * browser. No mocks: the component, its config and articles/graphs.json are the published ones.
 * Skips (exit 0) when Playwright or Chromium is not available, as the estate's tests do.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
let chromium
try {
    ({ chromium } = await import('playwright'))
} catch (e) {
    try {
        const g = execSync('npm root -g').toString().trim()
        ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs')))
    } catch (e2) { console.log('SKIP: playwright is not installed'); process.exit(0) }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.tpl': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }
const server = http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (p.startsWith(ROOT) && fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html')    // as GitHub Pages does
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' })
    fs.createReadStream(p).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://127.0.0.1:${server.address().port}/`

let browser
browser = await launch()

let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }); await routeApi(ctx)
const pg = await ctx.newPage()
const errors = []
pg.on('pageerror', e => errors.push(e.message))
pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const state = () => pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'))
const shadow = (sel, q) => pg.evaluate(([s, q]) => {
    const e = document.querySelector(s)
    return e && e.shadowRoot ? (q ? [...e.shadowRoot.querySelectorAll(q)].length : e.shadowRoot.textContent) : null
}, [sel, q])
const scrollTo = d => pg.evaluate(d => {
    const m = document.querySelector('main'), r = m.getBoundingClientRect()
    window.scrollTo(0, r.top + scrollY + r.height * d - innerHeight)
}, d)
const wait = ms => pg.waitForTimeout(ms)
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'articles/graphs.json'), 'utf8')).articles
const art = feed.slice().sort((a, b) => b.date < a.date ? -1 : 1)
const today = new Date().toISOString().slice(0, 10)
const older = art.find(a => (Date.parse(today) - Date.parse(a.date)) / 86400000 > 8)

try {
    // depth
    await pg.goto(B + `articles/${older.slug}.html`); await wait(1200)
    let s = await state()
    check(s && s.log[0].price === 5 && s.log[0].cost === 0.5, `opening an older article charges a tenth of 5p (${s && s.log[0].cost})`)
    // the charge follows the scroll; WebKit in CI needed the scroll re-issued, so poll for it (up to 3 s) rather than wait once
    for (let i = 0; i < 10; i++) { await scrollTo(0.5); await wait(300); s = await state(); if (s.log[0].cost > 0.5) break }
    check(s.log[0].cost > 0.5 && s.log[0].cost < 5, `half way down costs part of the price (${s.log[0].cost}p)`)
    // images load lazily and lengthen the page, so the end is reached the way a reader reaches it:
    // keep scrolling until the page stops growing
    for (let i = 0; i < 4; i++) { await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(700) }
    s = await state()
    check(s.log[0].cost === 5 && s.balance === 495, `the end costs the whole price (balance ${s.balance}, spent ${s.spent}, cost ${s.log[0].cost}, log ${s.log.length}, reads ${s.reads})`)
    // the reader card: usefulness sets the price, and the article is in the reading list
    const rate = n => pg.evaluate(n => document.querySelector('sg-meter[view=page]').shadowRoot.querySelectorAll('.seg')[0].querySelectorAll('button')[n - 1].click(), n)
    check((await state()).personas[0].on.includes(older.slug), 'an article opened for the first time joins the reading list')
    await rate(5); await wait(300); s = await state()
    check(s.log[0].cost === 10 && s.balance === 490, `rated excellent, it costs double (${s.log[0].cost}p)`)
    await rate(1); await wait(300); s = await state()
    check(s.log[0].cost === 0 && s.balance === 500, 'rated not useful, it is free')
    await rate(3); await wait(300)
    // decline
    await pg.evaluate(() => document.querySelector('sg-meter[view=page]').shadowRoot.querySelector('button.link').click()); await wait(200)
    await pg.evaluate(() => document.querySelector('sg-meter[view=page]').shadowRoot.querySelector('.reasons button').click()); await wait(300)
    s = await state()
    check(s.balance === 500 && s.log[0].declined && s.log[0].declined.reason === 'clickbait', 'declining refunds the page and keeps the reason')
    await pg.reload(); await wait(1000)
    s = await state()
    check(s.log.length === 1 && s.balance === 500, 'a reload in the same session does not charge again')
    // below zero, nothing blocked
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('sgit.meter.v1')); s.balance = 2; localStorage.setItem('sgit.meter.v1', JSON.stringify(s)) })
    await pg.goto(B + `articles/${art[0].slug}.html`); await wait(1000)
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(900)
    s = await state()
    check(s.balance < 0, `the balance goes below zero (${s.balance})`)
    check(await pg.evaluate(() => document.querySelector('sg-meter.meter-nav').shadowRoot.querySelector('a').classList.contains('neg')), 'the top bar marks a negative balance')
    // the payment return page, once per reference. The article's charge grows with scroll depth for a moment after the
    // scroll, so wait until the balance has stopped moving before taking it as the figure the top-up adds to.
    for (let i = 0, prev = s.balance; i < 10; i++) { await wait(300); const n = (await state()).balance; if (n === prev) break; prev = n }
    s = await state()
    const before = s.balance
    await pg.goto(B + 'account/topped-up.html?session_id=cs_test_1'); await wait(1000)
    await pg.reload(); await wait(1000)
    s = await state()
    check(Math.abs(s.balance - (before + 500)) < 0.01 && s.topups.length === 1, 'the return page adds a top-up once per reference')
    // personas
    await pg.goto(B + 'account/newsroom.html'); await wait(2000)
    check((await shadow('sg-meter[view=newsroom]', '.preset')) >= 5, 'the newsroom offers the starting personas')
    await pg.evaluate(() => document.querySelector('sg-meter[view=newsroom]').shadowRoot.querySelector('.preset button').click()); await wait(1200)
    s = await state()
    const pid = s.active
    check(pid !== 'me' && s.personas.length === 2, `adding a preset makes it active (${pid})`)
    check((await shadow('sg-meter[view=newsroom]', '.pickwrap')) > 0, 'the new persona has picks')
    await pg.evaluate(() => { const r = document.querySelector('sg-meter[view=newsroom]').shadowRoot; r.querySelectorAll('.pact')[0].querySelectorAll('button')[1].click() }); await wait(800)
    await pg.evaluate(() => { const r = document.querySelector('sg-meter[view=newsroom]').shadowRoot; r.querySelectorAll('.pact')[0].querySelectorAll('button')[0].click() }); await wait(800)
    s = await state()
    const p = s.personas.find(x => x.id === pid)
    check(p.on.length === 1 && p.off.length === 1, 'Keep and Not for this persona curate the active persona')
    check(await pg.evaluate(() => {
        const g = document.querySelector('sg-meter[view=newsroom]').shadowRoot.querySelector('sg-meter[view=graph]')
        return !!(g && g.shadowRoot && g.shadowRoot.querySelector('svg.graph'))
    }), 'the newsroom draws the persona graph')
    await pg.goto(B + `articles/${art[1].slug}.html`); await wait(900)
    s = await state()
    check(s.log[0].persona === pid, 'a page read is credited to the active persona')
    // export and restore into a fresh browser
    const file = path.join(os.tmpdir(), `sg-meter-export-${process.pid}.json`)
    fs.writeFileSync(file, JSON.stringify(s))
    const fresh = await browser.newContext(); await routeApi(fresh)
    const p2 = await fresh.newPage()
    p2.on('dialog', d => d.accept())
    await p2.goto(B + 'account/index.html'); await p2.waitForTimeout(1500)
    const input = await p2.evaluateHandle(() => document.querySelector('sg-meter[view=account]').shadowRoot.querySelector('input.file'))
    await input.asElement().setInputFiles(file); await p2.waitForTimeout(1500)
    const r = await p2.evaluate(() => JSON.parse(localStorage.getItem('sgit.meter.v1')))
    check(r.reads === s.reads && r.personas.length === 2, 'an export restores balance, history and personas in another browser')
    fs.unlinkSync(file)
    // sharing: the page shows exactly what would be sent, and copies it
    await pg.goto(B + 'account/share.html'); await wait(1500)
    const preview = await pg.evaluate(() => document.querySelector('sg-meter[view=share]').shadowRoot.querySelector('textarea.preview').value)
    check(/^My reading on /.test(preview) && /\nData:\n\{/.test(preview) && !/cs_test_1/.test(preview), 'the share preview has the summary and data, and no payment references')
    const sendState = () => pg.evaluate(() => document.querySelector('sg-meter[view=share]').shadowRoot.querySelector('button[type=submit]').disabled)
    check(await sendState(), 'Send is disabled until the reader ticks the consent box')
    await pg.evaluate(() => document.querySelector('sg-meter[view=share]').shadowRoot.querySelector('input[name=consent]').click())
    check(!(await sendState()), 'ticking the consent box enables Send')
    await clipboard(ctx)
    await pg.evaluate(() => [...document.querySelector('sg-meter[view=share]').shadowRoot.querySelectorAll('button')].find(b => /Copy to clipboard/.test(b.textContent)).click()); await wait(600)
    if (canReadClipboard) check((await pg.evaluate(() => navigator.clipboard.readText())) === preview, 'Copy puts exactly the preview on the clipboard')
    // v1.4.0: the account page has no Pause and no Start again, and a stored paused flag is cleared
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('sgit.meter.v1')); s.paused = true; localStorage.setItem('sgit.meter.v1', JSON.stringify(s)) })
    await pg.goto(B + 'account/index.html'); await wait(1500)
    const acct = await pg.evaluate(() => [...document.querySelector('sg-meter[view=account]').shadowRoot.querySelectorAll('.actions button, .actions a')].map(e => e.textContent.trim()))
    check(!acct.some(t => /pause|resume|start again/i.test(t)), `the account page has no Pause and no Start again (${acct.join(' | ')})`)
    check(acct.includes('Export as JSON') && acct.some(t => /^Top up/.test(t)), 'the account page keeps Top up and Export as JSON')
    await pg.goto(B + `articles/${art[3].slug}.html`); await wait(1200)
    s = await state()
    check(s.log[0].path.includes(art[3].slug) && s.log[0].cost > 0, 'a stored paused flag does not stop the meter')
    // a persona arriving by a link
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } }); await routeApi(ctx2)
    const lp = await ctx2.newPage(); lp.on('pageerror', e => errors.push(e.message))
    const lstate = () => lp.evaluate(() => JSON.parse(localStorage.getItem('sgit.meter.v1')))
    await lp.goto(B + 'persona/founder/'); await lp.waitForTimeout(2000)
    let ls = await lstate()
    const visitors = ls.personas.filter(x => x.visitor)
    check(visitors.length === 1 && visitors[0].preset === 'founder' && ls.active === visitors[0].id, 'a persona link adds the persona as a visitor and makes it active')
    check(ls.balance === 500 && ls.reads === 0 && ls.log.length === 0, 'opening a persona link charges nothing and reads nothing')
    const l = await lp.evaluate(() => { const sr = document.querySelector('sg-meter[view=landing]').shadowRoot, t = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : ''
        return { banner: t(sr.querySelector('.landing')), buttons: [...sr.querySelectorAll('.landing button')].map(t), picks: sr.querySelector('sg-meter[view=newsroom]').shadowRoot.querySelectorAll('.pickwrap').length } })
    check(/You are reading as/.test(l.banner) && /Morgan, the founder/.test(l.banner), 'the page says who you are reading as')
    check(l.buttons.includes('Keep this persona') && l.buttons.includes('Remove it'), 'a visitor can keep or remove the persona')
    check(l.picks > 0, `the newsroom under the banner has picks for the persona (${l.picks})`)
    await lp.reload(); await lp.waitForTimeout(1500)
    ls = await lstate()
    check(ls.personas.filter(x => x.preset === 'founder').length === 1, 'opening the link again does not add a second copy')
    await lp.evaluate(() => [...document.querySelector('sg-meter[view=landing]').shadowRoot.querySelectorAll('.landing button')].find(b => /Keep/.test(b.textContent)).click()); await lp.waitForTimeout(500)
    ls = await lstate()
    check(ls.personas.filter(x => x.preset === 'founder' && !x.visitor).length === 1, 'Keep makes the persona one of the reader\'s own')
    await lp.goto(B + 'persona/security/'); await lp.waitForTimeout(1500)
    await lp.evaluate(() => [...document.querySelector('sg-meter[view=landing]').shadowRoot.querySelectorAll('.landing button')].find(b => /Remove/.test(b.textContent)).click()); await lp.waitForTimeout(600)
    ls = await lstate()
    check(!ls.personas.some(x => x.preset === 'security') && ls.active === 'me' && ls.personas.some(x => x.preset === 'founder'), 'Remove takes the visitor away and leaves the others')
    await lp.goto(B + 'persona/#board'); await lp.waitForTimeout(1500)
    ls = await lstate()
    check(ls.personas.some(x => x.preset === 'board' && x.visitor), 'a #fragment names a persona on the picker page')
    await lp.goto(B + 'persona/#nobody'); await lp.waitForTimeout(1500)
    const unknown = await lp.evaluate(() => document.querySelector('sg-meter[view=landing]').shadowRoot.textContent.replace(/\s+/g, ' '))
    check(/no persona called/.test(unknown) && !(await lstate()).personas.some(x => /nobody/.test(x.id)), 'an unknown persona is said so, and nothing is added')
    await lp.goto(B + 'persona/'); await lp.waitForTimeout(1500)
    check((await lp.evaluate(() => document.querySelector('sg-meter[view=landing]').shadowRoot.querySelectorAll('.preset').length)) === 5, 'the picker shows the five personas')
    await clipboard(ctx2)
    await lp.evaluate(() => [...document.querySelector('sg-meter[view=landing]').shadowRoot.querySelectorAll('button')].find(b => /Copy link/.test(b.textContent)).click()); await lp.waitForTimeout(500)
    if (canReadClipboard) check(/\/persona\/founder\/$/.test(await lp.evaluate(() => navigator.clipboard.readText())), 'Copy link copies the persona\'s address')
    const links = JSON.parse(fs.readFileSync(path.join(ROOT, 'persona/links.json'), 'utf8')).personas
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/id="sg-meter-config">(.*?)<\/script>/s)[1]).personas.presets
    check(links.length === presets.length && links.every(x => presets.some(q => q.id === x.id) && x.url.endsWith(`/persona/${x.id}/`) && fs.existsSync(path.join(ROOT, `persona/${x.id}/index.html`))), 'links.json lists every persona, each with a page')
    await ctx2.close()
    // phones
    const mCtx = await routeApi(await browser.newContext({ viewport: { width: 390, height: 800 } })); const m = await mCtx.newPage()
    for (const u of ['account/newsroom.html', 'account/personas.html', 'account/share.html', 'account/index.html', 'persona/', 'persona/builder/', `articles/${art[0].slug}.html`]) {
        await m.goto(B + u); await m.waitForTimeout(1200)
        const w = await m.evaluate(() => document.documentElement.scrollWidth)
        check(w <= 390, `no sideways scroll at 390px: ${u} (${w})`)
    }
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL METER CHECKS PASS')
process.exit(failed ? 1 : 0)
