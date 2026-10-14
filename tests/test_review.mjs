#!/usr/bin/env node
/* test_review.mjs: the review's findings, pinned as the behaviour is today.
 *
 *   node admin/build/test_review.mjs
 *
 * The brief (articles/explorer-to-villager-newsroom.html, rule 3) says bugs are written as tests that pass,
 * recording the current behaviour, so that fixing one later is a visible change to a test and not a silent one.
 * Each check below carries the finding's id from newsroom-api/index.html (and admin/build/api_map.py). When a
 * finding is fixed, its check here is turned round in the same commit, deliberately.
 *
 * A check that says "ok" here therefore means "still as described", not "correct". Browser checks skip when
 * Playwright or Chromium is not available; the static checks always run.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
let failed = 0
const pin = (id, still, what) => { console.log(`${still ? 'ok  ' : 'FAIL'} ${id}: ${what}${still ? '' : ' (the behaviour changed: fix the finding and this check together)'}`); if (!still) failed++ }
const read = rel => fs.readFileSync(path.join(isApi(rel) ? API : ROOT, rel), 'utf8')   // the reader code is this repository's; the pages and data are the newsroom's

// ------------------------------------------------------------ static: what the files say
const contact = JSON.parse(read('.well-known/sgit-subscribe.json'))
pin('R5', contact.inbox.endpoint === 'https://dev.send.sgraph.ai', `the share and subscribe lane is on ${contact.inbox.endpoint}`)
pin('R5', /ORIGIN = 'https:\/\/dev\.vault\.sgraph\.ai'/.test(read('assets/vault-ui-embed.js')), 'the study page embeds dev.vault.sgraph.ai')
const cfg = JSON.parse(read('index.html').match(/id="sg-meter-config">(.*?)<\/script>/s)[1])
pin('R4', cfg.share.site === 'sgit.ai' && contact.site === 'sgit.ai' && /site@sgit\.ai/.test(read('assets/subscribe.js')), 'shares and subscriptions from this site are labelled sgit.ai')
let evalPages = 0, cspPages = 0, total = 0
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name), rel = path.relative(ROOT, p)
    if (e.isDirectory()) { if (!/^(archive|node_modules|\.git)$/.test(e.name)) walk(p) }
    else if (e.name.endsWith('.html')) { total++; const t = fs.readFileSync(p, 'utf8'); if (t.includes('(0,eval)(t)')) evalPages++; if (/http-equiv="Content-Security-Policy"/i.test(t)) cspPages++ }
} }
walk(ROOT)
pin('R10', evalPages > 300 && cspPages === 0, `${evalPages} of ${total} pages run fetched text through eval, and ${cspPages} set a Content-Security-Policy`)
const wf = fs.readFileSync(path.join(API, '.github/workflows/ci.yml'), 'utf8')
pin('R11', /test_meter/.test(wf) && /test_lists/.test(wf) && /test_review/.test(wf), 'CI runs the test files, here in the API repository (this one records the fix, not the bug)')
const core = read('assets/components/sg-meter/v1/v1.4/v1.4.1/sg-meter-core.js')
pin('R14', !/sessions\s*=\s*this\.state\.sessions\.slice/.test(core) && /this\.state\.sessions\.push\(ref\)/.test(core), 'payment references are kept unbounded and unchecked')
pin('R15', /\|\| this\.state\.personas\[0\]/.test(core), 'persona(id) falls back to personas[0], not to “me”')
pin('R17', /h = 0x811c9dc5/.test(read('for/reading-list.js')), 'a reading list\'s persona is keyed by a 32-bit hash')

// ------------------------------------------------------------ in a browser
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP the browser checks: playwright is not installed'); finish() }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.tpl': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.png': 'image/png' }
const hits = []
const server = http.createServer((req, res) => {
    hits.push(req.url)
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://127.0.0.1:${server.address().port}/`
let browser
browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }); await routeApi(ctx)
const pg = await ctx.newPage()
const state = () => pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'))
const setState = s => pg.evaluate(s => localStorage.setItem('sgit.meter.v1', JSON.stringify(s)), s)
const shadowText = sel => pg.evaluate(sel => { const e = document.querySelector(sel); return e && e.shadowRoot ? e.shadowRoot.textContent : null }, sel)
const wait = ms => pg.waitForTimeout(ms)
const ids = JSON.parse(read('articles/ids.json')).articles.filter(e => !e.withdrawn)
const art = ids[ids.length - 1].slug, art2 = ids[ids.length - 2].slug

try {
    // R1: a page declined as not relevant stays in the reading list
    await pg.goto(B + `articles/${art}.html`); await wait(1500)
    let s = await state()
    const kept = s.personas[0].on.includes(art) && s.log[0].autoKept === true
    await pg.evaluate(() => document.querySelector('sg-meter[view=page]').shadowRoot.querySelector('button.link').click()); await wait(200)
    await pg.evaluate(() => [...document.querySelector('sg-meter[view=page]').shadowRoot.querySelectorAll('.reasons button')].find(b => /Not relevant/.test(b.textContent)).click()); await wait(400)
    s = await state()
    pin('R1', kept && s.log[0].declined.reason === 'not-relevant' && s.personas[0].on.includes(art), 'an article declined as not relevant stays in the reading list it was auto-kept in')

    // R6: half-penny states do not add up on the card
    s = await state(); s.balance = 494.5; s.spent = 5.5; await setState(s)
    await pg.goto(B + 'account/index.html'); await wait(1500)
    const card = await pg.evaluate(() => document.querySelector('sg-meter[view=account]').shadowRoot.querySelector('.card').textContent)
    pin('R6', /£4\.95/.test(card) && /£0\.06 spent/.test(card), 'balance 494.5p shows as £4.95 and spent 5.5p as £0.06: £5.01 from £5.00')

    // R7: picks exclude pages read as any persona
    await pg.evaluate(() => localStorage.clear())
    await pg.goto(B + 'account/newsroom.html'); await wait(1500)
    await pg.evaluate(() => document.querySelector('sg-meter[view=newsroom]').shadowRoot.querySelector('.preset button').click()); await wait(1200)
    const pid = (await state()).active
    const picked = await pg.evaluate(() => [...document.querySelector('sg-meter[view=newsroom]').shadowRoot.querySelectorAll('.pick b')].map(b => b.textContent))
    const feed = JSON.parse(read('articles/graphs.json')).articles
    const firstPick = feed.find(a => a.title === picked[0])
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem('sgit.meter.v1')); s.active = 'me'; localStorage.setItem('sgit.meter.v1', JSON.stringify(s)) })
    await pg.goto(B + `articles/${firstPick.slug}.html`); await wait(1200)          // read it as "me"
    await pg.evaluate(id => { const s = JSON.parse(localStorage.getItem('sgit.meter.v1')); s.active = id; localStorage.setItem('sgit.meter.v1', JSON.stringify(s)) }, pid)
    await pg.goto(B + 'account/newsroom.html'); await wait(1500)
    const picked2 = await pg.evaluate(() => [...document.querySelector('sg-meter[view=newsroom]').shadowRoot.querySelectorAll('.pick b')].map(b => b.textContent))
    pin('R7', (await state()).log[0].persona === 'me' && !picked2.includes(firstPick.title), 'an article read as one persona is no longer picked for another')

    // R8: a failed feed fetch is cached for the life of the page
    const ctx2 = await browser.newContext(); await routeApi(ctx2); const p2 = await ctx2.newPage(); let n = 0
    await p2.route('**/articles/graphs.json', r => { n++; n === 1 ? r.fulfill({ status: 500, body: 'no' }) : r.continue() })
    await p2.goto(B + 'account/newsroom.html'); await p2.waitForTimeout(1500)
    await p2.evaluate(() => document.dispatchEvent(new CustomEvent('sg:meter.changed'))); await p2.waitForTimeout(800)
    const t2 = await p2.evaluate(() => document.querySelector('sg-meter[view=newsroom]').shadowRoot.textContent)
    pin('R8', n === 1 && /could not be loaded/.test(t2), 'after one failed fetch the feed is not fetched again on repaint')
    await ctx2.close()

    // R3: a malformed session id fails the whole element
    await pg.goto(B + 'account/topped-up.html?session_id=%E0%A4%A'); await wait(1200)
    const r3 = await pg.evaluate(() => { const e = document.querySelector('sg-meter[view=topped-up]'); return { state: e.getAttribute('data-state'), text: e.shadowRoot.textContent } })
    pin('R3', r3.state === 'error' && /URI malformed|malformed URI|URI error/i.test(r3.text), `a malformed percent sequence in session_id shows “did not load: …”: ${r3.text.trim().slice(0, 60)}`)   // the engine's own wording

    // R2: a restored file with a persona that has no arrays blanks the personas page
    await pg.evaluate(() => localStorage.clear())
    await pg.goto(B + `articles/${art2}.html`)                        // a charged page, so the state is saved
    // wait for the meter to have saved the state with the read logged, not a fixed time: on a loaded runner 1.2 s was not
    // always enough (the first run of v0.12.20 in CI), and a state pushed to before it is saved is overwritten by the save
    await pg.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'); return !!s && Array.isArray(s.personas) && Array.isArray(s.log) && s.log.length >= 1 } catch (e) { return false } }, null, { timeout: 20000 }).catch(() => {})
    await wait(300)
    s = await state(); s.personas.push({ id: 'p-bad', name: 'broken' }); await setState(s)
    await pg.goto(B + 'account/personas.html')
    // wait for the meter to say it is ready (or failed), not a fixed time: on a slow runner 1.5 s was not always enough
    await pg.waitForFunction(() => { const e = document.querySelector('sg-meter[view=personas]'); return e && /^(ready|error)$/.test(e.getAttribute('data-state') || '') }, null, { timeout: 20000 }).catch(() => {})
    await wait(500)
    const r2 = await pg.evaluate(() => { const e = document.querySelector('sg-meter[view=personas]'); return { state: e.getAttribute('data-state'), text: e.shadowRoot.textContent.trim() } })
    if (engine === 'chromium') pin('R2', r2.state === 'ready' && r2.text === '', 'a persona without on[] and off[] leaves the personas page blank')   // Chromium's behaviour; Firefox renders the page (issue 2)
    else console.log(`note R2 in ${engine}: state ${r2.state}, the personas page ${r2.text === '' ? 'is blank' : 'renders'}`)
} finally {
    await browser.close()
    server.close()
}
finish()

function finish() {
    console.log(failed ? `${failed} CHANGED: a finding's behaviour moved; update the finding and its check together` : 'ALL FINDINGS STILL AS RECORDED')
    process.exit(failed ? 1 : 0)
}
