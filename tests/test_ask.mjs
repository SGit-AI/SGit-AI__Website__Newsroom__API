#!/usr/bin/env node
/* test_ask.mjs: asking the site (card 033).
 *
 *   export NODE_PATH=$(npm root -g); node admin/build/test_ask.mjs
 *
 * In Node, against the index the build wrote: the passages a question finds (the best paragraph of each top page,
 * numbered, current wording only), the messages a model is given (the instruction to answer only from them and cite
 * them), and the citations in an answer turned into links. In Chromium, with no model reached for real: no model set
 * up (the passages alone, nothing sent); the reader's OpenRouter key, with openrouter.ai answered by a route in this
 * test (the key in the Authorization header and nowhere else, kept in the tab unless asked, forgotten on Forget; the
 * question and the passages in the body; the answer with its citations linked; what was sent shown; an error said);
 * Chrome's built-in model, faked with an init script (answered on the device, nothing sent; falling back to the key
 * when it is unavailable); ?ask=1; a phone. The key is made up per run.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium } from './harness.mjs'
const ROOT = SITE
needsChromium('ask (the faked built-in model)')
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const S = await import(path.join(API, 'assets/search/search.js'))
const A = await import(path.join(API, 'assets/search/ask.js'))

// ---------------------------------------------------------------- the passages and the messages, in Node
const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'search/docs.json'), 'utf8'))
const textFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'search/text.json'), 'utf8'))
const ix = S.buildIndex(docsFile); S.addText(ix, textFile)
const Q = 'how does the passkey PRF door open the vault?'
const ps = A.passagesFor(ix, Q)
check(ps.length >= 3 && ps.length <= 8 && ps.every((p, i) => p.n === i + 1 && p.title && p.u && p.text), `a question finds numbered passages (${ps.length})`)
check(ps[0].u === 'articles/the-passkey-opens-the-vault.html' && ps.filter(p => p.u === ps[0].u).length <= 2 && new Set(ps.map(p => p.u)).size >= 3, 'the best page first, at most two passages from it, and other pages after it')
check(ps.every(p => p.text.length <= 710), 'each passage is cut to about 700 characters')
const verTexts = new Set(textFile.chunks.filter(c => c.length > 3).map(c => c[2]))
check(ps.every(p => !verTexts.has(p.text)), 'passages are the current wording, not text from an earlier version')
const msgs = A.buildMessages(Q, ps)
check(msgs.length === 2 && msgs[0].role === 'system' && /ONLY from the numbered passages/.test(msgs[0].content) && /\[2\]/.test(msgs[0].content), 'the instruction: answer only from the passages, cite them by number')
check(msgs[1].role === 'user' && msgs[1].content.includes(Q) && ps.every(p => msgs[1].content.includes(`[${p.n}] ${p.title}`) && msgs[1].content.includes(`https://newsroom.sgit.ai/${p.u}`)), 'the question, then every passage with its number, title and address')
let runs = A.linkCitations('The door is derived [1], and kept [2, 3]; not [9].', 3)
check(JSON.stringify(runs) === JSON.stringify([['The door is derived ', null], ['[1]', 1], [', and kept ', null], ['[2]', 2], ['[3]', 3], ['; not [9].', null]]), 'citations become links, one per passage; a number with no passage stays text')
check(A.linkCitations('', 3).length === 0 && A.linkCitations('no citations', 3).length === 1, 'an answer with no citations is one run of text')
check(A.passagesFor(ix, 'zzqx vvbn').length === 0, 'a question the index has nothing for finds no passages')
check(A.OR_ENDPOINT === 'https://openrouter.ai/api/v1/chat/completions', 'the only endpoint a key is sent to is openrouter.ai')

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
const KEY = 'sk-or-v1-test-' + crypto.randomBytes(12).toString('hex')          // made up for this run; reaches no one
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, http-referer, x-title', 'access-control-allow-methods': 'POST, OPTIONS' }
const errors = []
async function newPage({ lm = null, width = 1280, height = 900 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height } }); await routeApi(ctx)
    const seen = { requests: [], hosts: new Set() }
    await ctx.route('https://openrouter.ai/**', async route => {
        const rq = route.request()
        if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
        const body = JSON.parse(rq.postData() || '{}')
        seen.requests.push({ url: rq.url(), headers: rq.headers(), body })
        if (seen.fail) return route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }) })
        return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ model: body.model, choices: [{ message: { role: 'assistant', content: 'The door is derived from the passkey\'s PRF output [1], and the vault opens with it [2].\n\nNothing else is needed [9].' } }], usage: { total_tokens: 123 } }) })
    })
    // no built-in model unless the test gives one; when it does, a fake with the Prompt API's shape
    await ctx.addInitScript(lm => {
        try { delete globalThis.LanguageModel } catch (e) { /* fine */ }
        try { if (globalThis.ai) delete globalThis.ai } catch (e) { /* fine */ }
        if (!lm) return
        globalThis.LanguageModel = {
            availability: async () => lm.avail,
            create: async opts => { globalThis.__lmCreate = { initialPrompts: opts.initialPrompts, expectedOutputs: opts.expectedOutputs }; return { prompt: async t => { globalThis.__lmPrompt = t; return 'On this device: the PRF door [1].' }, destroy() {} } },
        }
    }, lm)
    const pg = await ctx.newPage()
    pg.on('pageerror', e => errors.push(e.message))
    pg.on('console', m => { if (m.type() === 'error' && !/404|401/.test(m.text())) errors.push(m.text()) })
    pg.on('request', q => seen.hosts.add(new URL(q.url()).host))
    return { ctx, pg, seen }
}
const full = pg => pg.waitForFunction(() => (document.getElementById('search-mount') || { dataset: {} }).dataset.ready === 'full', null, { timeout: 60000 })
const text = (pg, sel) => pg.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent : '' }, sel)
const answered = (pg, re) => pg.waitForFunction(re => new RegExp(re).test((document.getElementById('ask-by') || {}).textContent || '') || new RegExp(re).test((document.getElementById('ask-answer') || {}).textContent || ''), re, { timeout: 30000 })
const storage = pg => pg.evaluate(() => ({ s: sessionStorage.getItem('sgit.ask.openrouter-key'), l: localStorage.getItem('sgit.ask.openrouter-key'), all: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) }))
try {
    // ---- no model: the passages alone, nothing sent
    let { ctx, pg, seen } = await newPage()
    await pg.goto(B + 'search/?q=' + encodeURIComponent(Q)); await full(pg)
    check(await pg.evaluate(() => !!document.querySelector('.search-box #ask-btn') && !!document.getElementById('ask-settings')), 'the search page has Ask beside Search, and How questions are answered')
    check(/No model is set up here/.test(await text(pg, '#ask-engine')), 'with no built-in model and no key, the page says so')
    await pg.click('#ask-btn'); await answered(pg, 'passages are shown alone')
    const items = await pg.evaluate(() => [...document.querySelectorAll('#ask-passages li')].map(li => ({ id: li.id, href: li.querySelector('a').getAttribute('href') })))
    check(items.length >= 3 && items[0].id === 'ask-p-1' && /articles\/the-passkey-opens-the-vault\.html(#[\w-]+)?$/.test(items[0].href), `Ask with no model: the passages, numbered and linked to their pages (${items.length})`)
    check(seen.requests.length === 0 && [...seen.hosts].every(h => h.startsWith('localhost') || h === API_HOSTNAME), 'nothing was sent anywhere')

    // ---- the reader's key
    await pg.click('#ask-settings summary'); await pg.fill('#ask-key', KEY); await pg.fill('#ask-model', 'mock/model'); await pg.click('#ask-save')
    let st = await storage(pg)
    check(st.s === KEY && st.l === null && /openrouter\.ai with your key, model mock\/model/.test(await text(pg, '#ask-engine')), 'the key is kept in this tab only, and the page says where questions go')
    await pg.click('#ask-btn'); await answered(pg, 'Answered by openrouter')
    const rq = seen.requests[0] || { headers: {}, body: {} }
    check(seen.requests.length === 1 && rq.url === A.OR_ENDPOINT && rq.headers.authorization === `Bearer ${KEY}`, 'one request, to openrouter.ai, with the key in the Authorization header')
    check(rq.body.model === 'mock/model' && rq.body.messages && rq.body.messages[1].content.includes(Q) && /\[1\] /.test(rq.body.messages[1].content) && !JSON.stringify(rq.body).includes(KEY), 'its body: the chosen model, the question and the numbered passages, and not the key')
    const cites = await pg.evaluate(() => [...document.querySelectorAll('#ask-answer a.cite')].map(a => [a.textContent, a.getAttribute('href')]))
    check(JSON.stringify(cites) === JSON.stringify([['[1]', '#ask-p-1'], ['[2]', '#ask-p-2']]) && /\[9\]/.test(await text(pg, '#ask-answer')) && (await pg.evaluate(() => document.querySelectorAll('#ask-answer p').length)) === 2, 'the answer in paragraphs, its citations linked to the passages; a number with no passage left as text')
    check(/model mock\/model, with your key\. Sent: the question and \d+ passages, [\d,]+ characters; 123 tokens/.test(await text(pg, '#ask-by')), `the page says who answered and what was sent: ${(await text(pg, '#ask-by')).trim().slice(0, 100)}`)
    const sentText = await text(pg, '#ask-sent pre')
    check(sentText.includes(Q) && /INSTRUCTION/.test(sentText) && !sentText.includes(KEY), 'What the model is given shows the instruction, the question and the passages, and not the key')
    seen.fail = true
    await pg.click('#ask-btn'); await answered(pg, 'No answer')
    check(/No answer: No auth credentials found/.test(await text(pg, '#ask-answer')) && (await pg.evaluate(() => document.querySelectorAll('#ask-passages li').length)) >= 3, 'an error from openrouter.ai is said, and the passages are still shown')
    seen.fail = false
    await pg.check('#ask-keep'); await pg.click('#ask-save')
    st = await storage(pg)
    check(st.l === KEY, 'Keep the key in this browser keeps it in local storage')
    await pg.click('#ask-forget')
    st = await storage(pg)
    check(st.s === null && st.l === null && !st.all.includes(KEY) && /No model is set up here/.test(await text(pg, '#ask-engine')), 'Forget the key takes it out of both')
    const others = [...seen.hosts].filter(h => !h.startsWith('localhost') && h !== API_HOSTNAME && h !== 'openrouter.ai')
    check(others.length === 0, `no host but this site and openrouter.ai${others.length ? ': ' + others.join(', ') : ''}`)
    await ctx.close()

    // ---- Chrome's built-in model
    ;({ ctx, pg, seen } = await newPage({ lm: { avail: 'available' } }))
    await pg.goto(B + 'search/?q=' + encodeURIComponent(Q) + '&ask=1'); await full(pg); await answered(pg, 'on this device')
    check(/built-in model/.test(await text(pg, '#ask-engine')), 'a browser with the built-in model: the page says questions are answered on this device')
    check(/On this device: the PRF door/.test(await text(pg, '#ask-answer')) && (await pg.evaluate(() => document.querySelectorAll('#ask-answer a.cite').length)) === 1 && /Nothing was sent anywhere/.test(await text(pg, '#ask-by')), '?ask=1 asks on arrival; the built-in model answers, with its citation linked')
    const lmSeen = await pg.evaluate(() => ({ c: globalThis.__lmCreate, p: globalThis.__lmPrompt }))
    check(lmSeen.c && lmSeen.c.initialPrompts[0].role === 'system' && /ONLY from the numbered passages/.test(lmSeen.c.initialPrompts[0].content) && lmSeen.c.expectedOutputs[0].languages[0] === 'en' && lmSeen.p.includes(Q), 'the built-in model is given the instruction as its system prompt, then the question and the passages')
    check(seen.requests.length === 0 && [...seen.hosts].every(h => h.startsWith('localhost') || h === API_HOSTNAME), 'nothing was sent anywhere')
    await ctx.close()

    // ---- the built-in model unavailable, a key set: openrouter.ai, and the page says why
    ;({ ctx, pg, seen } = await newPage({ lm: { avail: 'unavailable' } }))
    await pg.goto(B + 'search/?q=' + encodeURIComponent(Q)); await full(pg)
    await pg.click('#ask-settings summary'); await pg.fill('#ask-key', KEY); await pg.click('#ask-save')
    await pg.click('#ask-btn'); await answered(pg, 'Answered by openrouter')
    check(seen.requests.length === 1 && /The built-in model did not answer \(the built-in model is unavailable on this device\), so openrouter\.ai was asked/.test(await text(pg, '#ask-by')), 'the built-in model unavailable: the key is used, and the page says why')
    await ctx.close()

    // ---- a phone
    ;({ ctx, pg, seen } = await newPage({ width: 390, height: 844 }))
    await pg.goto(B + 'search/?q=' + encodeURIComponent('Wardley map')); await full(pg)
    await pg.click('#ask-settings summary'); await pg.click('#ask-btn'); await answered(pg, 'passages are shown alone')
    check((await pg.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await pg.evaluate(() => { const b = document.getElementById('ask-btn').getBoundingClientRect(); return b.right <= 390 && b.width > 30 })), 'at phone width: Ask fits beside Search, the answer and settings open, nothing scrolls sideways')
    await ctx.close()
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
}
finish()

function finish() {
    console.log(failed ? `${failed} FAILED` : 'ALL ASK CHECKS PASS')
    process.exit(failed ? 1 : 0)
}
