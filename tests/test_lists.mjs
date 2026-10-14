#!/usr/bin/env node
/* test_lists.mjs: a reading list in a link, tested the way the brief asks.
 *
 *   node admin/build/test_lists.mjs
 *
 * Part one needs nothing but node: the parser and the link builder (for/reading-list.js), against the real
 * article numbers (articles/ids.json): valid links, every malformed field, oversized lists, names with
 * markup, unknown numbers. Part two drives the built site in Chromium, as a recipient and as a sender:
 * the example link opens, the list becomes a visitor persona that can be kept or removed, what a link says is
 * shown as text, the page that makes a list makes a link that opens the same list, and nothing scrolls sideways
 * on a phone. Part two skips (and part one still counts) when Playwright or Chromium is not available.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

// ------------------------------------------------------------ part one: the parser, without a page
const L = await import(pathToFileURL(path.join(API, 'for/reading-list.js')).href)
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'articles/ids.json'), 'utf8'))
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/id="sg-meter-config">(.*?)<\/script>/s)[1])
const ctx = L.contextFrom(ids, cfg.personas.presets)
const live = ids.articles.filter(e => !e.withdrawn)
const N = live.map(e => e.n)
const [a, b, c, d] = N.slice(-4)
const nums = p => [p.read.map(e => e.n), p.look.map(e => e.n)]

let p = L.parse(`#from=Dinis&to=Steve&r=${a},${b},${c}&s=${d}&f=founder,c:how-agents-decide&n=Start%20here.&e=dinis@example.com`, ctx)
check(p.from === 'Dinis' && p.to === 'Steve' && p.note === 'Start here.' && p.email === 'dinis@example.com', 'a valid link: names, note and address')
check(JSON.stringify(nums(p)) === JSON.stringify([[a, b, c], [d]]), 'a valid link: the articles are in the order given')
check(p.follow.length === 2 && p.follow[0].kind === 'persona' && p.follow[1].kind === 'collection' && p.ignored.length === 0, 'a valid link: a persona and a collection to follow, nothing left out')

const spec = { from: 'Dinis', to: 'Steve', read: [c, a], look: [b], follow: ['founder', 'c:how-agents-decide'], note: 'A & B = C # D, “quoted” ?', email: 'me@example.org' }
const round = L.parse(new URL(L.build('https://x.test/for/', spec)).hash, ctx)
check(Object.keys(spec).every(k => JSON.stringify(L.specOf(round)[k]) === JSON.stringify(spec[k])), 'build then parse gives back the same list, including a note with & = # ? and quotes')
check(L.build('', { read: [] }) === '#', 'an empty list builds an empty fragment')

check(!L.parse('', ctx).given && !L.parse('#', ctx).given, 'no fragment: the page explains itself')
check(!L.parse('#something=else', ctx).given && L.parse('#something=else', ctx).ignored.length === 1, 'only unknown fields: the page explains itself, and says what it ignored')

p = L.parse(`#from=<b>Dinis</b>&to=Steve&r=${a}`, ctx)
check(p.from === '' && p.ignored.some(s => /sender/.test(s)), 'a name with markup is dropped and said so')
check(L.parse(`#to=${'x'.repeat(41)}&r=${a}`, ctx).to === '', 'a name over 40 characters is dropped')
check(L.parse(`#to=Steve2&r=${a}`, ctx).to === '' && L.parse('#to=-Steve&r=1', ctx).to === '', 'digits, and a name that does not start with a letter, are dropped')
for (const ok of ["Zoë", "Mary-Jane", "O'Neil", "Renée Dupont", "Søren"]) check(L.parse(`#to=${encodeURIComponent(ok)}&r=${a}`, ctx).to === ok, `the name ${ok} is accepted`)

p = L.parse(`#r=${a},99999,abc,-3,1.5,${a},${b}&s=${b},${c}`, ctx)
check(JSON.stringify(nums(p)) === JSON.stringify([[a, b], [c]]), 'unknown, non-numeric, negative, fractional and repeated numbers are dropped, the rest kept in order')
check(p.ignored.length === 6, `each dropped number is listed, and so is the one named twice (${p.ignored.length})`)
const many = L.parse(`#r=${N.slice(0, 60).join(',')}`, ctx)
check(many.read.length === L.LIMITS.list && many.ignored.length === 60 - L.LIMITS.list, `a list is cut at ${L.LIMITS.list} articles and says so`)
check(L.parse('#r=1,2&f=founder,nobody,c:nothing,c:how-agents-decide,founder', ctx).follow.length === 2, 'unknown personas and collections are dropped, repeats are not doubled')
check(L.parse(`#n=${'x'.repeat(241)}&r=${a}`, ctx).note === '' && L.parse(`#n=line%0Aone%09two&r=${a}`, ctx).note === 'line one two', 'a note over 240 characters is dropped, and line breaks become spaces')
check(L.parse(`#e=not-an-address&r=${a}`, ctx).email === '' && L.parse(`#e=javascript:alert(1)&r=${a}`, ctx).email === '', 'a reply address that is not one is dropped, so there is no button')
let threw = false
try { L.parse('#to=%E0%A4%A&r=%ZZ&s=%', ctx) } catch (e) { threw = true }
check(!threw, 'a link with broken percent-encoding does not throw')

check(L.titleFor(L.parse(`#from=Dinis&to=Steve&r=${a}`, ctx)) === 'For Steve, from Dinis' && L.personaName(L.parse(`#from=Dinis&to=Steve&r=${a}`, ctx)) === "Steve's list, from Dinis", 'the page and the persona are named for the two people')
check(L.personaName(L.parse(`#r=${a}`, ctx)) === 'A reading list', 'a list with no names is called a reading list')
const k1 = L.listKey(L.parse(`#from=Dinis&to=Steve&r=${a},${b}`, ctx))
check(k1 === L.listKey(L.parse(`#to=Steve&r=${a},${b}&from=Dinis&n=hello`, ctx)), 'the same list has the same key whatever the order of the fields or the note')
check(k1 !== L.listKey(L.parse(`#from=Dinis&to=Steve&r=${b},${a}`, ctx)) && k1 !== L.listKey(L.parse(`#from=Dinis&to=Mary&r=${a},${b}`, ctx)), 'a different order or recipient is a different list')

// the numbers themselves, read as a stranger would
const ns = ids.articles.map(e => e.n)
check(new Set(ns).size === ns.length && new Set(ids.articles.map(e => e.slug)).size === ids.articles.length, 'article numbers and addresses are unique')
check(ids.articles.every((e, i) => i === 0 || e.date >= ids.articles[i - 1].date), 'numbers run in the order articles were published')
check(ids.next > Math.max(...ns), 'the next number is above every number given')

// ------------------------------------------------------------ part two: the built site, in a browser
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP the browser tests: playwright is not installed'); finish() }
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
const B = `http://127.0.0.1:${server.address().port}/`
let browser
browser = await launch()
const errors = []
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: CLIPBOARD }); await routeApi(ctxB)
const pg = await ctxB.newPage()
pg.on('pageerror', e => errors.push(e.message))
pg.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
const wait = ms => pg.waitForTimeout(ms)
const state = () => pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'))
const titles = () => pg.evaluate(() => [...document.querySelectorAll('.rl .rl-item .rl-t')].map(e => e.textContent))
const want = ns => ns.map(n => ids.articles.find(e => e.n === n).title)
const link = `for/#from=Dinis&to=Steve&r=${a},${b},${c}&s=${d}&f=founder&n=Start%20with%20the%20first.&e=dinis@example.com`

try {
    // the example link, as a recipient
    await pg.goto(B + link); await wait(1800)
    check((await pg.evaluate(() => document.querySelector('h1.rl-title').textContent)) === 'For Steve, from Dinis', 'the list opens, headed for the two people')
    check(JSON.stringify(await titles()) === JSON.stringify(want([a, b, c, d])), 'the articles are listed in the order given, the look group last')
    check(await pg.evaluate(() => [...document.querySelectorAll('main.doc > h1, main.doc > p.eyebrow, #rl-docs')].every(e => e.hidden)), 'for a recipient the list is the page: the notes on how a link is made step aside')
    check(!!(await pg.$('a.rl-btn[href^="mailto:dinis@example.com"]')) && /Reply to Dinis/.test(await pg.evaluate(() => document.querySelector('a.rl-btn[href^=mailto]').textContent)), 'a reply address gives a Reply to Dinis button')
    let s = await state()
    const vis = s.personas.filter(x => x.visitor)
    check(vis.length === 1 && vis[0].name === "Steve's list, from Dinis" && s.active === vis[0].id, 'the list is added as a visitor persona named for the two people, and is active')
    check(JSON.stringify(vis[0].on) === JSON.stringify([a, b, c, d].map(n => ids.articles.find(e => e.n === n).slug)), 'the list is its reading list, in the sender\'s order')
    check(s.balance === 500 && s.log.length === 0 && s.reads === 0, 'opening a list charges nothing and reads nothing')
    await pg.reload(); await wait(1500)
    s = await state()
    check(s.personas.filter(x => x.list).length === 1, 'opening the same link again does not add a second persona')
    await pg.evaluate(() => [...document.querySelectorAll('.rl-persona button')].find(b => /Keep/.test(b.textContent)).click()); await wait(400)
    s = await state()
    check(s.personas.some(x => x.list && !x.visitor), 'Keep makes the list one of the reader\'s own personas')
    // a second list, removed
    await pg.goto(B + `for/#from=Ana&to=Bo&r=${a}`); await wait(1500)
    check((await state()).personas.filter(x => x.list).length === 2, 'a different list is a second persona')
    await pg.evaluate(() => [...document.querySelectorAll('.rl-persona button')].find(b => /Remove/.test(b.textContent)).click()); await wait(400)
    s = await state()
    check(s.personas.filter(x => x.list).length === 1 && s.personas.some(x => x.id === 'me') && s.active === 'me', 'Remove takes the visitor away and leaves the reader\'s own personas')
    check(/Removed/.test(await pg.evaluate(() => document.querySelector('.rl-persona').textContent)) && (await titles()).length === 1, 'after Remove the list is still on the page, with a way to add it back')
    // what a link says is shown as text
    await pg.goto(B + `for/#from=Dinis&to=Steve&r=${a}&n=%3Cb%3Ebold%3C%2Fb%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.pwned%3D1%3E&x=1&s=99999`); await wait(1500)
    check(await pg.evaluate(() => { const n = document.querySelector('.rl-note'); return n && n.children.length === 0 && /<b>bold<\/b>/.test(n.textContent) && !window.pwned }), 'a note with markup is shown as text and runs nothing')
    check(/Left out/.test(await pg.evaluate(() => document.querySelector('.rl-ignored').textContent)), 'what was malformed is listed under Left out')
    await pg.goto(B + `for/#from=%3Cscript%3E&to=Steve&r=${a}`); await wait(1500)
    check(await pg.evaluate(() => !document.querySelector('.rl script') && !/script/i.test(document.querySelector('.rl-title').textContent)), 'a name with markup is dropped, not shown')
    await pg.goto(B + `for/#to=Steve&r=${a}`); await wait(1500)
    check(!(await pg.$('a[href^="mailto:"]')), 'no reply address, no Reply button')
    // no fragment, and nothing to show
    await pg.goto(B + 'for/'); await wait(1500)
    check(/A reading list is a link/.test(await pg.evaluate(() => document.querySelector('#rl-mount').textContent)) && (await pg.$('#rl-mount a[href*="#from"]')), 'no fragment: the page explains a reading list and offers an example')
    await pg.goto(B + 'for/#r=99999'); await wait(1500)
    check(/nothing in this list/.test(await pg.evaluate(() => document.querySelector('#rl-mount').textContent)), 'a list with no article that exists says there is nothing to show')

    // the article footer
    await pg.goto(B + 'articles/pay-after-you-read.html'); await wait(1200)
    const no = ids.articles.find(e => e.slug === 'pay-after-you-read').n
    check(await pg.evaluate(n => [...document.querySelectorAll('main p.small')].some(p => p.textContent.includes(`Article No. ${n}`) && p.querySelector(`a[href$="for/make.html#r=${n}"]`)), no), `an article shows its number, with a link that starts a list with it (No. ${no})`)

    // the page that makes a list
    const listPersonas = (await state()).personas.filter(x => x.list).length
    await pg.goto(B + `for/make.html#r=${a}`); await wait(1800)
    check((await pg.evaluate(() => document.querySelectorAll('.mk-order[data-group=read] .mk-item').length)) === 1, 'a link from an article starts a list with that article in it')
    const clickRow = (n, which) => pg.evaluate(([n, which]) => {
        const row = [...document.querySelectorAll('.mk-row')].find(r => r.querySelector('.rl-n').textContent === `No. ${n}`)
        ;[...row.querySelectorAll('button')].find(b => b.textContent === which).click()
    }, [n, which])
    await pg.fill('input[name=from]', 'Dinis'); await pg.fill('input[name=to]', 'Steve')
    await clickRow(b, 'Read'); await clickRow(c, 'Read'); await clickRow(d, 'Look')
    await wait(300)
    let out = await pg.inputValue('textarea.mk-link')
    check(out === `https://newsroom.sgit.ai/for/#from=Dinis&to=Steve&r=${a},${b},${c}&s=${d}`, `the page makes the link (${out.replace('https://newsroom.sgit.ai/for/', '')})`)
    await pg.evaluate(n => { const li = [...document.querySelectorAll('.mk-order[data-group=read] .mk-item')].find(x => x.textContent.includes(`No. ${n}`)); [...li.querySelectorAll('button')].find(b => b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('up')).click() }, c)
    await wait(300)
    out = await pg.inputValue('textarea.mk-link')
    check(new URL(out).hash.includes(`r=${a},${c},${b}`), 'Move up changes the order in the link')
    const previewTitles = await pg.evaluate(() => [...document.querySelectorAll('.mk-preview .rl-item .rl-t')].map(e => e.textContent))
    check(JSON.stringify(previewTitles) === JSON.stringify(want([a, c, b, d])), 'the preview shows the list in the order it will be read')
    check((await state()).personas.filter(x => x.list).length === listPersonas, 'the preview does not touch the maker\'s own personas')
    // the link the page made opens the same list on the page that opens one
    const hash = new URL(out).hash
    await pg.goto(B + 'for/' + hash); await wait(1800)
    check(JSON.stringify(await titles()) === JSON.stringify(previewTitles), 'the link the page made opens the same list as the preview showed')
    // loading an existing link back into the form, and the limit
    await pg.goto(B + 'for/make.html'); await wait(1500)
    await pg.evaluate(() => document.querySelector('.mk-details').open = true)
    await pg.fill('.mk-details input', `https://newsroom.sgit.ai/${link}`); await pg.evaluate(() => [...document.querySelectorAll('.mk-details button')].find(b => b.textContent === 'Load').click()); await wait(500)
    check((await pg.inputValue('input[name=to]')) === 'Steve' && (await pg.inputValue('textarea[name=n]')) === 'Start with the first.' && (await pg.evaluate(() => document.querySelectorAll('.mk-order .mk-item').length)) === 4, 'an existing link loads into the form for editing')
    await pg.fill('input[name=to]', 'Steve<b>'); await wait(200)
    check(/Recipient/.test(await pg.evaluate(() => document.querySelector('.mk-msg').textContent)) && !/Steve<b>/.test(await pg.inputValue('textarea.mk-link')), 'a name that is not allowed is said so, and is not put in the link')
    await pg.goto(B + 'for/make.html#r=' + N.slice(0, 50).join(',')); await wait(1800)
    check(await pg.evaluate(() => [...document.querySelectorAll('.mk-row:not([hidden]):not(.picked) .mk-btns button')].filter(b => !b.disabled).length === 0), 'at 50 articles the other articles cannot be added')
    await pg.goto(B + 'for/make.html'); await wait(1500)
    await pg.fill('.mk-filters input[type=search]', 'persona'); await wait(300)
    const shown = await pg.evaluate(() => [...document.querySelectorAll('.mk-row:not([hidden])')].length)
    check(shown > 0 && shown < live.length, `searching narrows the articles (${shown} of ${live.length})`)
    await pg.selectOption('.mk-filters select:nth-of-type(2)', 'founder'); await pg.fill('.mk-filters input[type=search]', ''); await wait(300)
    check((await pg.evaluate(() => [...document.querySelectorAll('.mk-row:not([hidden])')].length)) === live.filter(e => e.personas.includes('founder')).length, 'the persona filter lists that persona\'s starting articles')
    // copy
    await pg.goto(B + `for/make.html#to=Steve&r=${a}`); await wait(1500)
    await pg.evaluate(() => [...document.querySelectorAll('.mk-side button')].find(b => b.textContent === 'Copy link').click()); await wait(400)
    if (canReadClipboard) check((await pg.evaluate(() => navigator.clipboard.readText())) === `https://newsroom.sgit.ai/for/#to=Steve&r=${a}`, 'Copy link puts the link on the clipboard')

    // phones
    const mCtx = await routeApi(await browser.newContext({ viewport: { width: 390, height: 800 } })); const m = await mCtx.newPage()
    m.on('pageerror', e => errors.push(e.message))
    for (const u of [link, 'for/', `for/make.html#from=Dinis&to=Steve&r=${a},${b},${c}&s=${d}`, 'for/make.html']) {
        await m.goto(B + u); await m.waitForTimeout(1500)
        const w = await m.evaluate(() => document.documentElement.scrollWidth)
        check(w <= 390, `no sideways scroll at 390px: ${u.slice(0, 40)} (${w})`)
    }
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
}
finish()

function finish() {
    console.log(failed ? `${failed} FAILED` : 'ALL READING LIST CHECKS PASS')
    process.exit(failed ? 1 : 0)
}
