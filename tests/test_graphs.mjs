#!/usr/bin/env node
/* test_graphs.mjs: the graphs drawn from a wire's bundle (wire/graphs.js).
 *
 *   node admin/build/test_graphs.mjs
 *   WIRE_CLONES=/path/to/a/clone,/path/to/another node admin/build/test_graphs.mjs   # also against real bundles
 *
 * Two parts. In Node: the module's source is read and must use no innerHTML, outerHTML, insertAdjacentHTML or
 * document.write; the pure tables (co-occurrence, threads, stories by day, the sources' tally, the deliveries) are
 * computed from a fixture that has every shape the vaults use plus the broken ones (a story that is a string, a
 * primary that is a number, entities that are not lists, dates in the wrong form, an id called __proto__), and must
 * neither throw nor lose a well-formed row. In Chromium, through Playwright, the drawing functions run on a small
 * page served from this tree: every svg has role=img, an aria-label and a title; the counts match the data (one dot
 * per source, one column per day, one bar per source, one cell per recorded delivery); and a story whose every field
 * is a hostile string (a closing tag, a script, an attribute with a handler, a javascript: url) produces no element
 * and no attribute that is not on this file's own list, and that string is only ever text. jsdom is not installed,
 * so the DOM part skips (exit 0) when Playwright or Chromium is missing, and says so.
 *
 * CHROMIUM_SPKI_ALLOW is honoured as test_wire.mjs does, though this test makes no request beyond localhost.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

/* ---- the fixture: every shape the vaults use, and the broken ones ---- */
const HOSTILE = '<img src=x onerror=alert(1)>"><script>alert(2)</script> onclick=alert(3) javascript:alert(4) __proto__ constructor'
const story = (id, beat, date, extra = {}) => ({ id, beat, date, headline: `Headline of ${id}`, summary: 'A summary.', quote: 'A quote.', quote_source_url: 'https://example.org/cover-1',
    primary: { title: `Primary of ${id}`, url: `https://example.org/${id}`, publisher: 'Example Org', date, tier: 'A', source: 'example-org' }, primary_fetched: true,
    coverage: [{ title: 'Cover 1', url: 'https://example.org/cover-1', publisher: 'Outlet One', date, tier: 'C', source: 'outlet-one' }, { title: 'Cover 2', url: 'https://example.org/cover-2', publisher: 'Outlet Two', date, tier: 'B' }],
    entities: { orgs: ['OpenAI', 'Anthropic'], people: [], products: ['Claude Code'], tech: ['AI agents'], cves: [] }, personas: ['founder'], confidence: 'high', status: 'ai-generated, unreviewed', ...extra })
const FIX = {
    stories: [
        story('sec-01', 'cybersecurity', '2026-10-12', { entities: { orgs: ['SonicWall', 'openai'], cves: ['CVE-2026-1'], products: ['SMA 1000'] }, primary_fetched: false, primary: { title: 'Advisory', url: 'https://psirt.example/1', publisher: 'SonicWall PSIRT', tier: null, source: null } }),
        story('ai-02', 'building-with-ai', '2026-10-12'),
        story('ai-03', 'building-with-ai', '2026-10-11', { entities: { orgs: ['Anthropic'], cves: ['CVE-2026-1'] }, coverage: [] }),
        story('biz-04', 'ai-business', '2026-10-05', { primary: { publisher: 'Unregistered Blog', url: 'not a url', tier: 'Z' }, coverage: 'not a list', entities: 'not an object', date: '12 October' }),
        story('gov-05', 'risk-governance', '2026-09-30', { primary: 7, entities: { orgs: [null, 42, { a: 1 }, 'OpenAI'] }, coverage: [null, 'x', { publisher: 'Outlet Three', tier: 'A' }] }),
        'not a story', null, 17,
        { id: '__proto__', beat: '__proto__', date: '2026-10-12', headline: 'A story called __proto__', entities: { orgs: ['OpenAI'] }, primary: { publisher: 'constructor', source: '__proto__' } },
        { beat: 'cybersecurity', date: '2026-10-12', headline: 'A story with no id', primary: { publisher: 'Example Org', source: 'example-org' } },
        { id: 'hostile', beat: HOSTILE, date: HOSTILE, headline: HOSTILE, summary: HOSTILE, quote: HOSTILE, quote_source_url: HOSTILE, primary: { title: HOSTILE, url: HOSTILE, publisher: HOSTILE, tier: HOSTILE, source: HOSTILE }, primary_fetched: HOSTILE,
          coverage: [{ title: HOSTILE, url: 'javascript:alert(5)', publisher: HOSTILE, tier: HOSTILE }], entities: { orgs: [HOSTILE], cves: [HOSTILE], [HOSTILE]: [HOSTILE] }, personas: [HOSTILE], status: HOSTILE, edition: HOSTILE },
    ],
    beats: [{ id: 'cybersecurity', label: 'Cybersecurity' }, { id: 'building-with-ai', label: 'Building with AI' }, 'not a beat'],
    sources: [{ id: 'example-org', name: 'Example Org site', tier: 'A' }, { id: 'outlet-one', name: 'Outlet One', tier: 'C' }, null, { name: 'Unregistered Blog' }],
    personas: [{ id: 'dinis', name: 'Dinis' }, { id: 'founder', name: 'Morgan' }, { id: HOSTILE, name: HOSTILE }, 'x', { name: 'no id' }],
    deliveries: [{ story: 'sec-01', persona: 'dinis', status: 'reached', connections: [{ concern: 'a' }] }, { story: 'sec-01', persona: 'founder', status: 'withheld', withheld_reason: 'no concern matched' },
                 { story: 'ai-02', persona: 'dinis', status: 'withheld' }, { story: 'ai-02', persona: 'founder', status: 'reached' }, { story: 'hostile', persona: HOSTILE, status: 'reached' }, { story: 'nope', persona: 'dinis', status: 'reached' }, null, 'x', { status: 'reached' }],
    threads: [{ id: 't1', title: 'Thread one', stories: ['sec-01', 'ai-03', 'nope', 'biz-04'] }, { id: 't2', title: HOSTILE, stories: ['ai-02', 'sec-01', { id: 'ai-03' }, 7] }, null, 'x', { stories: 'not a list' }],
}
FIX.byId = Object.fromEntries(FIX.stories.filter(s => s && typeof s === 'object' && s.id).map(s => [s.id, s]))

/* ---- 1. the source: no HTML strings become markup ---- */
const src = fs.readFileSync(path.join(API, 'wire/graphs.js'), 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')   // the code, not its comments, which name what they avoid
check(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/.test(code), 'graphs.js uses no innerHTML, outerHTML, insertAdjacentHTML, document.write, DOMParser or contextual fragments')
check(/createElementNS\(SVG/.test(src) && /createTextNode/.test(src), 'graphs.js makes elements with createElementNS and labels with text nodes')
check(!/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/url\(#pv-arrow\)/g, '')) && (src.match(/var\(--[a-z0-9-]+\)/g) || []).length > 20, 'graphs.js writes every colour as a theme token (var(--token)), never a literal')

/* ---- 2. the pure tables, in Node ---- */
const G = await import(path.join(API, 'wire/graphs.js'))
check(['provenanceStrip', 'provenanceGraph', 'cooccurrence', 'threadsTimeline', 'storiesByDay', 'sourcesTally', 'deliveriesMatrix', 'cooccurrenceTable', 'threadRows', 'storiesByDayTable', 'sourcesTallyTable', 'deliveriesTable', 'sourcesOf', 'entitiesOf'].every(k => typeof G[k] === 'function'), 'the module exports the seven drawings and the six tables')

const co = G.cooccurrenceTable(FIX.stories, { min: 2, max: 40 })
check(co.map(r => `${r.entity}:${r.count}`).join(' ') === 'OpenAI:4 Anthropic:2 CVE-2026-1:2' && co[0].stories.join() === 'sec-01,ai-02,gov-05,__proto__', `co-occurrence: entities named by two or more stories, case-insensitively, most named first (${co.map(r => `${r.entity}:${r.count}`).join(' ')})`)
check(co.find(r => r.entity === 'OpenAI').stories.includes('__proto__') && co.find(r => r.entity === 'OpenAI').stories.includes('sec-01'), 'co-occurrence: a story id of __proto__ is a story like any other, and openai matches OpenAI')
check(G.cooccurrenceTable(FIX.stories, { min: 3 }).length === 1 && G.cooccurrenceTable(FIX.stories, { max: 1 }).length === 1 && G.cooccurrenceTable(null).length === 0 && G.cooccurrenceTable('x', 'y').length === 0, 'co-occurrence: min and max are honoured, nothing in gives nothing out')

const th = G.threadRows(FIX.threads, FIX.byId)
check(th.length === 5 && th[0].stories.map(s => s.id).join() === 'ai-03,sec-01' && th[0].undated.join() === 'nope,biz-04' && th[1].stories.length === 3 && th[4].stories.length === 0, `threads: dated stories in date order, undated ones counted, a thread that is not an object is an empty row (${th.map(r => r.stories.length).join('/')})`)
check(G.threadRows(FIX.threads, new Map(Object.entries(FIX.byId)))[0].stories.length === 2 && G.threadRows('x', null).length === 0, 'threads: a Map or an object of stories by id, nothing in gives nothing out')

const bd = G.storiesByDayTable(FIX.stories, { days: 14 })
check(bd.days.length === 14 && bd.end === '2026-10-12' && bd.start === '2026-09-29' && bd.total === 6 && bd.undated === 5, `stories by day: 14 days ending on the latest dated story, ${bd.total} dated stories, ${bd.undated} left out`)
check(bd.days[13].total === 4 && bd.days[13].byBeat.cybersecurity === 2 && bd.days[13].byBeat.__proto__ === 1 && bd.beats.map(b => `${b.id}:${b.total}`).join(' ') === 'building-with-ai:2 cybersecurity:2 __proto__:1 risk-governance:1', 'stories by day: stacked by beat with a beat called __proto__ counted as a key, the beats ordered by total')
check(G.storiesByDayTable(FIX.stories, { days: 3, end: '2026-10-11' }).days.map(d => d.total).join() === '0,0,1' && G.storiesByDayTable([], {}).days.length === 14 && G.storiesByDayTable(null, { days: -1 }).days.length === 14, 'stories by day: an end date and a window are honoured, bad values fall back to 14 days')

const st = G.sourcesTallyTable(FIX.stories, FIX.sources, { max: 30 })
check(st.rows[0].key === 'example-org' && st.rows[0].name === 'Example Org site' && st.rows[0].count === 3 && st.rows[0].tier === 'A' && st.rows[0].registered, `sources: the primary's source id resolves to the registry's name and tier (${st.rows.map(r => `${r.name}:${r.count}:${r.tier || '-'}`).join(' ')})`)
check(st.rows.find(r => r.key === 'Unregistered Blog') && st.rows.find(r => r.key === 'Unregistered Blog').tier === '' && st.rows.find(r => r.key === 'SonicWall PSIRT') && st.rows.find(r => r.key === '__proto__'), 'sources: a publisher without a source id is a row, an unknown tier is none, __proto__ is a key')
check(G.sourcesTallyTable(FIX.stories, null, { max: 2 }).rows.length === 2 && G.sourcesTallyTable(null, null).rows.length === 0, 'sources: max is honoured, nothing in gives nothing out')

const dl = G.deliveriesTable(FIX.stories, FIX.personas, FIX.deliveries, {})
check(dl.cols.length === 3 && dl.rows.length === 11 && dl.reached === 3 && dl.withheld === 2 && dl.rows[0].cells.join() === 'reached,withheld,none' && dl.rows[1].cells.join() === 'withheld,reached,none', `deliveries: ${dl.cols.length} personas with an id, ${dl.rows.length} rows, ${dl.reached} reached, ${dl.withheld} withheld`)
check(G.deliveriesTable(FIX.stories, FIX.personas, FIX.deliveries, { max: 2 }).rows.length === 2 && G.deliveriesTable(null, null, null).rows.length === 0, 'deliveries: max is honoured, nothing in gives nothing out')

check(G.sourcesOf(FIX.stories[0]).length === 3 && !G.sourcesOf(FIX.stories[0])[0].fetched && G.sourcesOf(FIX.stories[0])[1].quoted && G.sourcesOf(FIX.stories[0])[1].tier === 'C' && G.sourcesOf(null).length === 1 && G.sourcesOf({ coverage: 'x', primary: 7 }).length === 1, 'sourcesOf: the primary first and always, the quoted outlet marked, the tier kept; a broken story is one unnamed primary')
check(G.entitiesOf(FIX.stories[0]).map(e => e.kind).join() === 'cve,org,org,product' && G.entitiesOf(FIX.stories[4]).length === 1 && G.entitiesOf(FIX.stories[3]).length === 0 && G.entitiesOf(null).length === 0, 'entitiesOf: CVEs first, non-strings dropped, a string where an object should be is nothing')

/* ---- real bundles, when WIRE_CLONES names clones ---- */
for (const clone of (process.env.WIRE_CLONES || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const f = path.join(clone, 'data/bundle.json')
    if (!fs.existsSync(f)) { check(false, `${clone}: no data/bundle.json`); continue }
    const b = JSON.parse(fs.readFileSync(f, 'utf8'))
    const del = fs.existsSync(path.join(clone, 'data/deliveries.json')) ? JSON.parse(fs.readFileSync(path.join(clone, 'data/deliveries.json'), 'utf8')) : []
    const c = G.cooccurrenceTable(b.stories, { min: 2, max: 40 }), d = G.storiesByDayTable(b.stories, { days: 14 }), t = G.sourcesTallyTable(b.stories, b.sources), m = G.deliveriesTable(b.stories, b.personas, del), r = G.threadRows((b.brief || {}).threads, new Map(b.stories.map(s => [s.id, s])))
    check(c.length > 0 && c.every(x => x.count >= 2) && d.total > 0 && t.rows.length > 0 && t.stories === b.stories.filter(s => (s.primary || {}).source || (s.primary || {}).publisher).length && m.reached + m.withheld === del.filter(x => b.stories.some(s => s.id === x.story) && b.personas.some(p => p.id === x.persona)).length && r.length === ((b.brief || {}).threads || []).length,
        `${path.basename(clone)}: ${b.stories.length} stories: ${c.length} co-occurring entities (top ${c[0] && c[0].entity} ${c[0] && c[0].count}), ${d.total} stories in the last 14 days ending ${d.end} across ${d.beats.length} beats, ${t.sources} sources (top ${t.rows[0] && t.rows[0].name} ${t.rows[0] && t.rows[0].count}), ${m.reached} reached and ${m.withheld} withheld of ${del.length} deliveries, ${r.length} threads`)
}

/* ---- 3. the drawings, in Chromium ---- */
let chromium
try { ({ chromium } = await import('playwright')) } catch (e) {
    try { const g = execSync('npm root -g').toString().trim(); ;({ chromium } = await import(path.join(g, 'playwright', 'index.mjs'))) }
    catch (e2) { console.log('SKIP: playwright is not installed; the DOM checks did not run'); console.log(failed ? `${failed} FAILED` : 'ALL GRAPH CHECKS PASS (Node part)'); process.exit(failed ? 1 : 0) }
}
// a page of this tree's module, and the themes' tokens, served from here; nothing else
const PAGE = `<!doctype html><html data-theme="night"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/themes/themes.css"><link rel="stylesheet" href="/wire/wire.css"></head><body><main id="m"></main>
<script type="module">import * as G from '/wire/graphs.js'; window.G = G; document.documentElement.setAttribute('data-ready', '1')</script></body></html>`
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x').pathname
    if (u === '/__graphs.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return }
    const f = path.join(ROOT, decodeURIComponent(u))
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const B = `http://localhost:${server.address().port}/`
const args = process.env.CHROMIUM_SPKI_ALLOW ? [`--ignore-certificate-errors-spki-list=${process.env.CHROMIUM_SPKI_ALLOW}`] : []
let browser
browser = await launch({ args })
const pgCtx = await routeApi(await browser.newContext({ viewport: { width: 1000, height: 800 } })); const pg = await pgCtx.newPage()
const errors = []
pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()) })
try {
    await pg.goto(B + '__graphs.html'); await pg.waitForFunction(() => document.documentElement.getAttribute('data-ready') === '1', null, { timeout: 20000 })
    await pg.evaluate(F => { window.FIX = F }, FIX)
    // draw everything once, into the page, and describe what came out
    const out = await pg.evaluate(() => {
        const m = document.getElementById('m'), F = window.FIX, G = window.G, byId = new Map(F.stories.filter(s => s && s.id).map(s => [s.id, s]))
        const draw = (name, el) => { const w = document.createElement('section'); w.dataset.g = name; w.append(el); m.append(w); return w }
        draw('strip', G.provenanceStrip(F.stories[0])); draw('strip2', G.provenanceStrip(F.stories[1])); draw('stripBroken', G.provenanceStrip(F.stories[4])); draw('stripNull', G.provenanceStrip(null)); draw('stripHostile', G.provenanceStrip(F.stories[10]))
        draw('graph', G.provenanceGraph(F.stories[0])); draw('graphHostile', G.provenanceGraph(F.stories[10])); draw('graphNull', G.provenanceGraph('x'))
        const co = G.cooccurrence(F.stories, { min: 2, max: 40 }); draw('co', co); draw('coEmpty', G.cooccurrence([], {}))
        draw('threads', G.threadsTimeline(F.threads, byId)); draw('threadsEmpty', G.threadsTimeline(null, null))
        draw('byday', G.storiesByDay(F.stories, { days: 14, beats: F.beats })); draw('bydayEmpty', G.storiesByDay(null, null))
        draw('tally', G.sourcesTally(F.stories, F.sources)); draw('tallyEmpty', G.sourcesTally([], []))
        draw('matrix', G.deliveriesMatrix(F.stories, F.personas, F.deliveries)); draw('matrixEmpty', G.deliveriesMatrix([], [], []))
        const q = (g, sel) => m.querySelector(`[data-g="${g}"]`).querySelectorAll(sel).length
        const svgs = [...m.querySelectorAll('svg')]
        return {
            svgs: svgs.length, labelled: svgs.filter(s => s.getAttribute('role') === 'img' && s.getAttribute('aria-label') && s.querySelector('title') && s.querySelector('title').textContent === s.getAttribute('aria-label')).length,
            strip: { dots: q('strip', 'circle'), primaryHollow: m.querySelector('[data-g="strip"] g.p circle').getAttribute('fill'), dashed: m.querySelector('[data-g="strip"] g.p circle').getAttribute('stroke-dasharray'), rings: q('strip', 'g.c circle'), label: m.querySelector('[data-g="strip"] svg').getAttribute('aria-label'), label2: m.querySelector('[data-g="strip2"] svg').getAttribute('aria-label'), broken: q('stripBroken', 'circle'), nul: q('stripNull', 'circle'), hostile: q('stripHostile', 'circle') },
            graph: { src: q('graph', 'g.src'), ents: q('graph', 'g.ent'), cve: q('graph', 'g.ent.cve'), links: [...m.querySelectorAll('[data-g="graph"] a')].map(a => a.getAttribute('href')), edges: [...m.querySelectorAll('[data-g="graph"] text.edge')].map(t => t.textContent), quoted: [...m.querySelectorAll('[data-g="graph"] g.src text')].some(t => /quoted/.test(t.textContent)), dashed: m.querySelector('[data-g="graph"] g.src.primary rect').getAttribute('stroke-dasharray'), hostileLinks: q('graphHostile', 'a'), nul: q('graphNull', 'svg') },
            co: { rows: q('co', 'g.ent'), stories: q('co', 'g.story'), lines: q('co', 'path'), table: co.table.length, empty: q('coEmpty', 'svg'), emptyText: m.querySelector('[data-g="coEmpty"] p').textContent },
            threads: { rows: q('threads', 'g.story'), lines: q('threads', 'line'), empty: q('threadsEmpty', 'svg') },
            byday: { cols: q('byday', 'g.day'), rects: q('byday', 'g.day rect'), legend: q('byday', '.legend li'), empty: q('bydayEmpty', 'g.day'), width: m.querySelector('[data-g="byday"] svg').getBoundingClientRect().width },
            tally: { bars: q('tally', 'g.bar'), empty: q('tallyEmpty', 'svg') },
            matrix: { rows: q('matrix', 'g.row'), cells: q('matrix', 'g.row rect'), empty: q('matrixEmpty', 'svg') },
            tags: [...new Set([...m.querySelectorAll('*')].map(e => e.tagName.toLowerCase()))].sort(),
            attrs: [...new Set([...m.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.name)))].sort(),
            hostileAsText: [...m.querySelectorAll('[data-g="graphHostile"] text, [data-g="graphHostile"] title')].some(t => t.textContent.includes('<img src=x')) && [...m.querySelectorAll('[data-g="stripHostile"] title')].some(t => t.textContent.includes('<script>')),
            hostileInAttr: [...m.querySelectorAll('*')].flatMap(e => [...e.attributes]).filter(a => /<img|<script|javascript:/.test(a.value)).map(a => a.name),
            scripts: m.querySelectorAll('script, img, iframe, object, embed, foreignObject, [onerror], [onclick], [onload]').length,
            fills: [...new Set([...m.querySelectorAll('[fill], [stroke]')].flatMap(e => [e.getAttribute('fill'), e.getAttribute('stroke')]).filter(Boolean))],
            resolved: getComputedStyle(m.querySelector('[data-g="strip"] g.p circle')).stroke,
        }
    })
    check(out.svgs === 14 && out.labelled === out.svgs, `${out.svgs} svgs drawn, every one role=img with an aria-label that is also its <title>`)
    const ALLOWED_TAGS = ['a', 'circle', 'defs', 'figcaption', 'figure', 'g', 'li', 'line', 'marker', 'p', 'path', 'rect', 'section', 'span', 'svg', 'text', 'title', 'ul']
    check(out.tags.every(t => ALLOWED_TAGS.includes(t)), `only this file's own elements exist (${out.tags.join(' ')})`)
    const ALLOWED_ATTRS = ['aria-label', 'class', 'cx', 'cy', 'd', 'data-g', 'fill', 'font-size', 'font-weight', 'height', 'href', 'id', 'markerheight', 'markerwidth', 'marker-end', 'opacity', 'orient', 'r', 'refx', 'refy', 'rel', 'role', 'rx', 'stroke', 'stroke-dasharray', 'stroke-width', 'style', 'target', 'text-anchor', 'transform', 'viewbox', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2']
    check(out.attrs.every(a => ALLOWED_ATTRS.includes(a.toLowerCase())), `only this file's own attribute names exist (${out.attrs.filter(a => !ALLOWED_ATTRS.includes(a.toLowerCase())).join(' ') || 'none outside the list'})`)
    check(out.hostileAsText && out.hostileInAttr.every(a => a === 'aria-label') && out.scripts === 0, `a hostile string in every field is text only: no script, image, frame or handler; it reaches an attribute only as the aria-label's value (${out.hostileInAttr.join(',') || 'none'})`)
    check(out.graph.hostileLinks === 0 && out.graph.links.length === 3 && out.graph.links.every(h => /^https:\/\/example\.org|^https:\/\/psirt/.test(h)), `a link is made only from an http(s) url: ${out.graph.links.length} in the graph, none from the hostile story`)
    check(out.fills.every(f => /^var\(--[a-z0-9-]+\)$/.test(f) || f === 'none'), `every fill and stroke is a token or none (${out.fills.length} distinct)`)
    check(/^rgb/.test(out.resolved) && out.resolved !== 'none', `the tokens resolve under a theme (the primary's stroke is ${out.resolved} in Night)`)
    // the strip
    check(out.strip.dots === 4 && out.strip.primaryHollow === 'none' && out.strip.dashed && out.strip.rings === 3, `strip: 1 primary + 2 coverage dots and a ring on the quoted outlet; the unfetched primary is hollow and dashed`)
    check(/^3 sources: the primary is SonicWall PSIRT, not fetched; 2 other outlets \(1 tier B, 1 tier C\); the quote is from Outlet One\.$/.test(out.strip.label), `strip: the title says how many sources and of what kind: "${out.strip.label}"`)
    check(/^3 sources: the primary is Example Org; 2 other outlets/.test(out.strip.label2) && out.strip.broken === 2 && out.strip.nul === 1 && out.strip.hostile === 2, `strip: a fetched primary, a story whose coverage is mostly rubbish (2 dots), null (1 dot) and the hostile story (2 dots) all draw`)
    // the graph
    check(out.graph.src === 3 && out.graph.ents === 4 && out.graph.cve === 1 && out.graph.edges.join() === 'is_primary_for,covers,names' && out.graph.quoted && out.graph.dashed === '5 4' && out.graph.nul === 1, `graph: 3 sources, 4 entities (1 CVE), the edges labelled, the quoted source marked, the unfetched primary dashed`)
    // co-occurrence, threads, by day, tally, matrix
    check(out.co.rows === 3 && out.co.table === 3 && out.co.stories === 5 && out.co.lines === 8 && out.co.empty === 0 && /No entity/.test(out.co.emptyText), `co-occurrence: 3 entities, 5 stories, 8 lines; the table on the figure; an empty edition is a sentence`)
    check(out.threads.rows === 5 && out.threads.empty === 0, `threads: 5 dated story dots across the rows; nothing in is a sentence`)
    check(out.byday.cols === 14 && out.byday.rects === 5 && out.byday.legend === 4 && out.byday.empty === 14 && out.byday.width > 900, `by day: 14 columns, 5 stacked segments, a legend of 4 beats; the chart fills its column (${Math.round(out.byday.width)}px)`)
    check(out.tally.bars === 5 && out.tally.empty === 0, `tally: 5 bars; nothing in is a sentence`)
    check(out.matrix.rows === 11 && out.matrix.cells === 5 && out.matrix.empty === 0, `matrix: 11 rows, 5 recorded cells; nothing in is a sentence`)
    // phone width: nothing scrolls sideways
    await pg.setViewportSize({ width: 390, height: 800 })
    check((await pg.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at 390px')
    check(errors.length === 0, `no page errors or warnings${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally { await browser.close(); server.close() }
console.log(failed ? `${failed} FAILED` : 'ALL GRAPH CHECKS PASS')
process.exit(failed ? 1 : 0)
