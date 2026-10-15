#!/usr/bin/env node
/* test_site.mjs: the website on api.newsroom.sgit.ai (www/, written by site/build.py), held to the newsroom's own bar.
 *
 *   node tests/test_site.mjs            # BROWSER=chromium|webkit|firefox
 *
 * The newsroom's test_themes.mjs is the model (cards 036, 037, 038 there):
 *   1. site/assets/themes.css defines every token in every one of the five themes (a theme with a hole inherits Newsprint's
 *      value silently, and ships one light panel in a dark theme).
 *   2. site/assets/site.css writes no literal colour outside the token block at its top (the terminal palette is the one
 *      exception, as in the newsroom).
 *   3. On three pages (the home, a doc page, the review): Newsprint with nothing stored under a light system; the picker lists
 *      five and is closed until asked; choosing Night sets data-theme on <html>, is kept in localStorage under
 *      newsroom.theme, repaints the page and is still there on the next page; a stored value that is not a theme is ignored;
 *      in every theme the body ink, paragraph text, headings, links and the ink on the accent hold 4.5:1 (WCAG AA);
 *      no page errors.
 *   4. At widths from 2000 down to 360: the bar is one row and not collapsed from 1280 up, collapsed behind Menu below, and
 *      nothing is wider than the viewport at any width; at 768 the menu opens every section.
 *
 * Serves www/ itself; no network. Skips (exit 0) when the engine is missing, and says so.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { API, TYPES, launch, engine, routeApi } from './harness.mjs'

const WWW = path.join(API, 'www')
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const THEMES = ['newsprint', 'night', 'paper', 'blueprint', 'ember']

/* ---- 1. every token in every theme ---- */
const css = fs.readFileSync(path.join(API, 'site/assets/themes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const blocks = {}
for (const m of css.matchAll(/:root(?:\[data-theme="([a-z]+)"\])?\s*\{([^}]*)\}/g)) {
    const name = m[1] || 'newsprint'
    if (m.index > css.indexOf('@media print')) continue
    blocks[name] = new Set([...m[2].matchAll(/--([a-z0-9-]+)\s*:/g)].map(x => x[1]))
}
check(THEMES.every(t => blocks[t]), `themes.css declares the five themes: ${Object.keys(blocks).join(', ')}`)
const all = new Set(THEMES.flatMap(t => [...(blocks[t] || [])]))
for (const t of THEMES) {
    const missing = [...all].filter(k => !blocks[t].has(k))
    check(missing.length === 0, `${t} defines every token (${blocks[t].size})${missing.length ? ': missing ' + missing.join(', ') : ''}`)
}
const nr = '/home/user/SGit-AI__Website__Newsroom'   // when the newsroom checkout is beside this tree, the two token files agree
const NEWSROOM = process.env.NEWSROOM || path.join(API, '.newsroom')
const nrThemes = path.join(NEWSROOM, 'assets/themes/themes.css')
if (fs.existsSync(nrThemes)) {
    const theirs = fs.readFileSync(nrThemes, 'utf8')
    const a = theirs.slice(theirs.indexOf('/* ---------- A. the tokens'), theirs.indexOf('/* ---------- B. the override map')).trim()
    const c = theirs.slice(theirs.indexOf('/* ---------- C. the picker')).trim()
    const ours = fs.readFileSync(path.join(API, 'site/assets/themes.css'), 'utf8')
    check(ours.includes(a) && ours.includes(c), 'the tokens and the picker are the newsroom\'s file, unchanged (layers A and C)')
    check(fs.readFileSync(path.join(API, 'site/assets/themes.js'), 'utf8') === fs.readFileSync(path.join(NEWSROOM, 'assets/themes/themes.js'), 'utf8'), 'themes.js is the newsroom\'s, byte for byte')
}

/* ---- 2. no literal colour outside the token block ---- */
{
    const t = fs.readFileSync(path.join(API, 'site/assets/site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const body = t.slice(t.indexOf('*{box-sizing'))
    const literals = [...body.matchAll(/var\([^)]*\)|(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bcolor-mix\()/g)].map(m => m[1]).filter(Boolean)
    check(literals.length === 0, `site.css: no literal colour outside a token${literals.length ? ' (' + [...new Set(literals)].join(' ') + ')' : ''}`)
}

/* ---- the browser ---- */
const server = http.createServer((req, res) => {
    let f = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (f.startsWith(WWW) && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
    if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://localhost:${server.address().port}/`
const browser = await launch()

const lum = s => { const [r, g, b] = s.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * r + .7152 * g + .0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }

const PAGES = [['the home', 'index.html'], ['a doc page', 'for-developers/index.html'], ['the review', 'review/index.html']]
try {
    /* ---- 3. the picker, the memory, the contrast ---- */
    for (const [what, rel] of PAGES) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
        const pg = await ctx.newPage(); const errors = []
        pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
        await pg.goto(B + rel)
        check((await pg.getAttribute('html', 'data-theme')) === 'newsprint', `${what}: Newsprint with nothing stored (light system)`)
        check((await pg.$$('.theme-pick li button')).length === 5, `${what}: the picker lists five themes`)
        check(await pg.evaluate(() => document.querySelector('.theme-pick ul').hidden), `${what}: the menu is closed until asked`)
        await pg.click('.theme-pick > button')
        check(await pg.evaluate(() => !document.querySelector('.theme-pick ul').hidden && document.activeElement.getAttribute('data-theme') === 'newsprint'), `${what}: the menu opens with the current theme focused`)
        const before = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor)
        await pg.click('.theme-pick [data-theme="night"]')
        check((await pg.getAttribute('html', 'data-theme')) === 'night' && (await pg.evaluate(() => localStorage.getItem('newsroom.theme'))) === 'night', `${what}: choosing Night sets data-theme and stores it under newsroom.theme`)
        check((await pg.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== before, `${what}: the page repaints`)
        check(await pg.evaluate(() => document.querySelector('.theme-pick > button .name').textContent === 'Night' && document.querySelector('.theme-pick ul').hidden), `${what}: the button names Night and the menu closed`)
        await pg.goto(B + 'releases/index.html')
        check((await pg.getAttribute('html', 'data-theme')) === 'night', `${what}: Night is still the theme on the next page`)
        await pg.evaluate(() => localStorage.setItem('newsroom.theme', 'javascript:alert(1)'))
        await pg.goto(B + rel)
        check((await pg.getAttribute('html', 'data-theme')) === 'newsprint', `${what}: a stored value that is not a theme is ignored`)
        for (const t of THEMES) {
            await pg.evaluate(t => window.__newsroomTheme.set(t), t)
            const m = await pg.evaluate(() => {
                const cs = getComputedStyle(document.body), p = document.querySelector('main.doc p:not([class])'), a = document.querySelector('main a[href]:not(.btn):not(.card):not(.door)')
                const root = getComputedStyle(document.documentElement)
                return { bg: cs.backgroundColor, fg: cs.color, text: p ? getComputedStyle(p).color : cs.color, link: a ? getComputedStyle(a).color : cs.color,
                         accent: root.getPropertyValue('--accent-dk').trim(), on: root.getPropertyValue('--on-accent').trim(), head: root.getPropertyValue('--head').trim() }
            })
            const probe = await pg.evaluate(([a, on, head]) => { const d = document.createElement('div'); d.style.cssText = `background:${a};color:${on}`; document.body.appendChild(d); const cs = getComputedStyle(d); const r = [cs.backgroundColor, cs.color]; d.style.color = head; r.push(getComputedStyle(d).color); d.remove(); return r }, [m.accent, m.on, m.head])
            const c = { fg: contrast(m.fg, m.bg), text: contrast(m.text, m.bg), head: contrast(probe[2], m.bg), link: contrast(m.link, m.bg), on: contrast(probe[1], probe[0]) }
            const ok = Object.values(c).every(v => v >= 4.5)
            check(ok, `${what} in ${t}: ink ${c.fg.toFixed(1)}:1, text ${c.text.toFixed(1)}:1, headings ${c.head.toFixed(1)}:1, links ${c.link.toFixed(1)}:1, ink on the button ${c.on.toFixed(1)}:1 (all at least 4.5)`)
        }
        check(errors.length === 0, `${what}: no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
        await ctx.close()
    }
    /* ---- a dark system with nothing stored is Night ---- */
    {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
        const pg = await ctx.newPage(); await pg.goto(B + 'index.html')
        check((await pg.getAttribute('html', 'data-theme')) === 'night', 'a system set to dark, with nothing stored, gets Night')
        await ctx.close()
    }
    /* ---- 5. search: the site searches itself with the API's own component, loaded from this host's release ---- */
    {
        const ctx = await routeApi(await browser.newContext({ viewport: { width: 1280, height: 900 } }))
        const pg = await ctx.newPage(); const errors = []
        pg.on('pageerror', e => errors.push(e.message))
        await pg.goto(B + 'search/index.html?q=manifest')
        await pg.waitForFunction(() => document.querySelectorAll('#search-results li').length > 0, null, { timeout: 20000 }).catch(() => {})
        const n = await pg.evaluate(() => document.querySelectorAll('#search-results li').length)
        check(n > 0, `search: "manifest" finds ${n} page(s), ranked in the browser by assets/search/search.js from the release`)
        check(await pg.evaluate(() => [...document.querySelectorAll('#search-results li a')].some(a => /releases|docs/.test(a.getAttribute('href') || ''))), 'search: a result links to the releases or the docs')
        check(errors.length === 0, `search: no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
        await ctx.close()
    }
    /* ---- 4. the bar ---- */
    for (const w of [2000, 1600, 1440, 1366, 1280, 1279, 1024, 768, 390, 360]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 } })
        const pg = await ctx.newPage(); await pg.goto(B + 'about/index.html')
        await pg.evaluate(() => document.fonts ? document.fonts.ready : null)
        const m = await pg.evaluate(() => ({ h: Math.round(document.querySelector('header.top .row').getBoundingClientRect().height),
            collapsed: getComputedStyle(document.querySelector('.menu')).display !== 'none',
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }))
        if (w >= 1280) check(m.h < 62 && !m.collapsed, `at ${w}: one row (${m.h}px), not collapsed`)
        else check(m.collapsed, `at ${w}: collapsed behind Menu (${m.h}px)`)
        check(!m.overflow, `at ${w}: nothing wider than the viewport`)
        if (w === 768) {
            await pg.click('.menu')
            const n = await pg.evaluate(() => getComputedStyle(document.getElementById('nav')).display === 'flex' ? document.querySelectorAll('#nav a').length : 0)
            check(n >= 9, `at ${w}: Menu opens the sections (${n})`)
        }
        await ctx.close()
    }
} finally {
    await browser.close(); server.close()
}
console.log(failed ? `test_site: ${failed} failure(s) (${engine})` : `test_site: OK (${engine})`)
process.exit(failed ? 1 : 0)
