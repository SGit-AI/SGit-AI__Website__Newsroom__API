#!/usr/bin/env node
/* test_search.mjs: search in the browser (card 031).
 *
 *   export NODE_PATH=$(npm root -g); node admin/build/test_search.mjs
 *
 * In Node, against the index the build wrote (search/docs.json, search/text.json): what is in it, and the ranking,
 * with the owner's examples (a sentence since corrected, found in the version it read that way in; an address; a
 * number). In Chromium: the Search link in the nav, the page, results as you type, the query in the address, a phrase
 * found in an earlier version and linked to the version page, the filters, the reader's own records (read, done,
 * hide done), nothing sent to any other host, no sideways scroll on a phone.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const S = await import(path.join(API, 'assets/search/search.js'))

// ---------------------------------------------------------------- the index, in Node
const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'search/docs.json'), 'utf8'))
const textFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'search/text.json'), 'utf8'))
const version = fs.readFileSync(path.join(ROOT, 'admin/build/version.txt'), 'utf8').trim()
const docs = docsFile.docs, arts = docs.filter(d => d.k === 'article')
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'articles/ids.json'), 'utf8'))
check(docsFile.release === version && textFile.release === version, `the index is of this release (${docsFile.release})`)
check(arts.length === ids.articles.length && arts.every(d => d.n && d.d && (d.tg || []).length && d.g && d.x), `every article is in it with its number, date, tags, graph and teaser (${arts.length})`)
check(docs.filter(d => d.k === 'story').length >= 30 && docs.some(d => d.k === 'note') && docs.some(d => d.k === 'engineering'), 'the wire\'s stories, the notes and the engineering cards are in it')
check(docs.every((d, i) => d.i === i && d.u && !d.u.startsWith('search/')) && docs.filter(d => !d.u.includes('#')).every(d => fs.existsSync(path.join(ROOT, d.u))), 'every entry points at a page that exists, and the search page is not in it')
check(textFile.chunks.every(c => docs[c[0]] && typeof c[2] === 'string' && c[2].length), `every paragraph belongs to a page (${textFile.chunks.length})`)
const vchunks = textFile.chunks.filter(c => c.length > 3)
check(vchunks.length > 50 && vchunks.every(c => /^v\d+\.\d+\.\d+$/.test(c[3]) && fs.existsSync(path.join(ROOT, c[4]))), `wording from earlier versions is in it, each with its version and the page that shows the change (${vchunks.length})`)
const t0 = Date.now()
const ix = S.buildIndex(docsFile); S.addText(ix, textFile)
const ms = Date.now() - t0
check(ms < 5000, `the index builds in ${ms} ms in Node`)
const top = (q, opts) => S.search(ix, q, opts || {})
const at = (q, u, n = 3, opts) => top(q, opts).slice(0, n).findIndex(r => r.doc.u === u)
check(S.stem('agents') === S.stem('agent') && S.stem('thinking') === 'think' && S.stem('making') === S.stem('make') && S.stem('stories') === S.stem('story'), 'words are stemmed: agents agent, thinking think, making make, stories story')
let r = top('"I have not stopped thinking about"')
check(r.length >= 1 && r[0].doc.u === 'articles/who-owns-the-words.html' && r[0].inVersion && r[0].unit.ver === 'v1.0.0' && /versions\/who-owns-the-words\/v1\.1\.0\.html$/.test(r[0].unit.vurl), 'a sentence since corrected is found in the version it read that way in, with the page that shows the change')
r = top('"deserves a proper answer"')
check(at('"deserves a proper answer"', 'articles/who-owns-the-words.html', 2) >= 0 && !r.find(x => x.doc.u === 'articles/who-owns-the-words.html').inVersion, 'the sentence as it reads now is found in the article itself')
check(top('"a phrase that is in no page anywhere at all"').length === 0, 'a phrase in no page finds nothing')
r = top('97')
check(r.length === 1 && r[0].byNumber && r[0].doc.u === 'articles/who-owns-the-words.html', 'a number alone is that article')
check(at('agent@riskmandate.ai', 'articles/who-owns-the-words.html', 5) >= 0, 'an address finds the article that answers its sender')
check(at('passkey PRF door', 'articles/the-passkey-opens-the-vault.html', 1) === 0, 'passkey PRF door: the passkey article first')
check(at('passk', 'articles/the-passkey-opens-the-vault.html', 1) === 0, 'a word being typed is read as a prefix: passk')
check(at('sovereignty', 'articles/sovereignty-is-the-ability-to-move.html', 3) >= 0 && at('sovereignty', 'articles/move-the-cloud-not-the-code.html', 3) >= 0, 'sovereignty: both articles on it in the first three')
check(at('Wardley map', 'articles/why-i-love-wardley-maps.html', 1) === 0, 'Wardley map: Why I love Wardley maps first')
check(top('agents', { group: 'wire' }).every(x => ['story', 'wire'].includes(x.doc.k)) && top('agents', { group: 'articles' }).every(x => ['article', 'newsletter', 'desk', 'collection', 'deck', 'view'].includes(x.doc.k)), 'a filter keeps only its kinds of page')
check(top('').length === 0 && top('   ').length === 0 && top('the of and').length > 0, 'an empty query finds nothing; a query of common words alone still searches them')
const sn = S.snippet('with a digression I have not stopped thinking about. Paraphrasing: the setup', '"I have not stopped thinking about"')
check(sn.filter(x => x[1]).length === 1 && sn.find(x => x[1])[0] === 'I have not stopped thinking about', 'a phrase is marked as one span in the snippet')

// ---------------------------------------------------------------- the page, in Chromium
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP: playwright is not installed, so the page was not checked'); finish() }
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown', '.txt': 'text/plain', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    const f = path.join(ROOT, p)
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f))
})
await new Promise(r2 => server.listen(0, '127.0.0.1', r2))
const B = `http://localhost:${server.address().port}/`
const args = process.env.CHROMIUM_SPKI_ALLOW ? [`--ignore-certificate-errors-spki-list=${process.env.CHROMIUM_SPKI_ALLOW}`] : []
let browser
browser = await launch({ args })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await routeApi(ctx)
const pg = await ctx.newPage()
const errors = [], hosts = new Set()
pg.on('pageerror', e => errors.push(e.message))
pg.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
pg.on('request', q => hosts.add(new URL(q.url()).host))
const text = sel => pg.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent : '' }, sel)
const full = () => pg.waitForFunction(() => (document.getElementById('search-mount') || {}).dataset && document.getElementById('search-mount').dataset.ready === 'full', null, { timeout: 60000 })
const results = () => pg.evaluate(() => [...document.querySelectorAll('#search-results li.result')].map(li => ({ u: li.dataset.u, title: li.querySelector('h3').textContent, href: li.querySelector('h3 a').getAttribute('href'), snip: (li.querySelector('.snip') || {}).textContent || '', marks: [...li.querySelectorAll('mark')].map(m => m.textContent), meta: li.querySelector('.meta').textContent })))
try {
    // read an article first, so the search can say so
    await pg.goto(B + 'articles/sovereignty-is-the-ability-to-move.html'); await pg.waitForSelector('nav.site a.search-btn', { timeout: 20000 })
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await pg.waitForTimeout(900); await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(300)
    check(/Search/.test(await text('nav.site a.search-btn')), 'every page has a Search link in the nav')
    await pg.click('nav.site a.search-btn'); await pg.waitForSelector('#search-q', { timeout: 20000 }); await full()
    check(/search\/(index\.html)?$/.test(new URL(pg.url()).pathname) && /indexed in this browser/.test(await text('#search-status')) && /Searching sends nothing anywhere/.test(await text('#search-status')), `the search page loads the index: ${(await text('#search-status')).trim().slice(0, 90)}`)
    check((await pg.evaluate(() => document.querySelectorAll('#search-results li.tips a').length)) >= 4, 'with no query, it offers examples')
    await pg.fill('#search-q', 'sovereignty'); await pg.waitForTimeout(500)
    let res = await results()
    check(res.length >= 2 && res.slice(0, 3).some(x => x.u === 'articles/sovereignty-is-the-ability-to-move.html') && /q=sovereignty/.test(pg.url()), `results come as you type, and the query is in the address (${res.length})`)
    const sov = res.find(x => x.u === 'articles/sovereignty-is-the-ability-to-move.html')
    check(!!sov && /Read · you/.test(sov.meta) && /No\. 94/.test(sov.meta), 'a result I have read says so, with its number')
    check(res.every(x => x.marks.length === 0 || x.marks.some(m => /sovereign/i.test(m))), 'the snippets mark the words found')
    // a phrase since corrected
    await pg.goto(B + 'search/?q=' + encodeURIComponent('"I have not stopped thinking about"')); await full(); await pg.waitForTimeout(300)
    res = await results()
    check(res.length >= 1 && res[0].u === 'articles/who-owns-the-words.html' && /In v1\.0\.0, since changed/.test(res[0].snip) && res[0].marks.includes('I have not stopped thinking about'), 'a phrase from the address: found in v1.0.0 of Who owns the words, the phrase marked as one')
    check(/articles\/versions\/who-owns-the-words\/v1\.1\.0\.html$/.test(res[0].href), 'its link opens the version page that shows the change')
    // a number, and an anchor
    await pg.fill('#search-q', '97'); await pg.waitForTimeout(400)
    res = await results()
    check(res.length === 1 && res[0].u === 'articles/who-owns-the-words.html', 'a number alone is that article')
    await pg.fill('#search-q', 'passkey PRF door'); await pg.waitForTimeout(500)
    res = await results()
    check(res[0] && res[0].u === 'articles/the-passkey-opens-the-vault.html' && /\.html#[\w-]+$/.test(res[0].href), 'a result links to the section its best paragraph is in')
    // the filters
    const counts = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#search-filters button')].map(b => [b.dataset.group, Number((/\((\d+)\)/.exec(b.textContent) || [0, -1])[1])])))
    check(counts.all > 0 && counts.articles > 0 && counts.all >= counts.articles, `each filter shows its count (${JSON.stringify(counts)})`)
    await pg.click('#search-filters button[data-group="engineering"]'); await pg.waitForTimeout(300)
    res = await results()
    check(res.length > 0 && res.every(x => /^(engineering|admin)\//.test(x.u)) && /f=engineering/.test(pg.url()), 'a filter keeps only its kind, and is in the address')
    await pg.click('#search-filters button[data-group="all"]'); await pg.waitForTimeout(200)
    // done, and hiding it
    await pg.goto(B + 'articles/sovereignty-is-the-ability-to-move.html'); await pg.waitForSelector('.vault-btn', { timeout: 20000 })
    await pg.click('.vault-btn'); await pg.waitForTimeout(400); await pg.click('#vault-tab-page'); await pg.waitForTimeout(200); await pg.click('#note-done'); await pg.waitForTimeout(300)
    await pg.goto(B + 'search/?q=sovereignty'); await full(); await pg.waitForTimeout(300)
    res = await results()
    check(/Done/.test((res.find(x => x.u === 'articles/sovereignty-is-the-ability-to-move.html') || {}).meta || ''), 'a result I marked done says so')
    await pg.click('#search-hide-done'); await pg.waitForTimeout(300)
    res = await results()
    check(!res.some(x => x.u === 'articles/sovereignty-is-the-ability-to-move.html') && /done=hide/.test(pg.url()), 'Hide what I marked done takes it out, and is in the address')
    // what left the browser
    const others = [...hosts].filter(x => !x.startsWith('localhost') && x !== API_HOSTNAME)
    check(others.length === 0, `nothing was sent to any other host${others.length ? ': ' + others.join(', ') : ''}`)
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 })
    await m.goto(B + 'search/?q=wardley'); await m.waitForFunction(() => document.getElementById('search-mount').dataset.ready === 'full', null, { timeout: 60000 }); await m.waitForTimeout(400)
    check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await m.evaluate(() => document.querySelectorAll('#search-results li.result').length)) > 0, 'at phone width: results, and nothing scrolls sideways')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
}
finish()

function finish() {
    console.log(failed ? `${failed} FAILED` : 'ALL SEARCH CHECKS PASS')
    process.exit(failed ? 1 : 0)
}
