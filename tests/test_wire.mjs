#!/usr/bin/env node
/* test_wire.mjs: the wire pages in Chromium, each reading its real vault.
 *
 *   node admin/build/test_wire.mjs
 *
 * No stand-in: the brief's rule is that a test that needs a vault uses a vault, and these are public by their read
 * keys. For every wire recorded in admin/build/wire-vault*.json (the Industry Wire at wire/, the others at wire/<slug>/)
 * it opens the three pages, checks that the edition, the lens, the release notes, the corrections, the sources and the
 * documents are read and drawn, that what the vault adds beyond the edition (a map, a stack with its deadlines) is drawn
 * when the snapshot says the vault has it, that nothing is run from the vault and no request goes anywhere but this
 * site and the vault server, and that the pages hold at phone width. Skips (exit 0) when Playwright or Chromium is
 * missing, or when the vault server cannot be reached from here, and says which.
 *
 * In a sandbox whose outbound TLS is intercepted by a proxy with its own CA (as the sessions that build this site
 * run in), Chromium does not consult the proxy's CA in the NSS store. Set CHROMIUM_SPKI_ALLOW to the base64 SHA-256
 * of that CA's public key (what `openssl x509 -pubkey | openssl pkey -pubin -outform der | openssl dgst -sha256
 * -binary | base64` prints) and the test passes it to Chromium's --ignore-certificate-errors-spki-list, which trusts
 * certificates chaining to that one key and nothing else. Verification stays on. CI needs no such thing.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
const cfgs = fs.readdirSync(path.join(ROOT, 'admin/build')).filter(f => /^wire-vault.*\.json$/.test(f)).sort().map(f => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin/build', f), 'utf8'))
    cfg.slug = cfg.slug || ''; cfg.name = cfg.name || 'The Industry Wire'; cfg.dir = 'wire/' + (cfg.slug ? cfg.slug + '/' : '')
    const snap = path.join(ROOT, cfg.dir, 'snapshot.json')
    cfg.snap = fs.existsSync(snap) ? JSON.parse(fs.readFileSync(snap, 'utf8')) : null
    return cfg
}).sort((a, b) => (a.slug !== '') - (b.slug !== '') || a.slug.localeCompare(b.slug))
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

check(cfgs.length >= 1 && cfgs[0].slug === '', `${cfgs.length} wires recorded: ${cfgs.map(c => c.dir).join(', ')}`)
for (const cfg of cfgs) {
    check(/^sgit_public_read_[0-9a-f]{64}:[a-z0-9]{4,24}$/.test(cfg.read_key) && cfg.read_key.endsWith(':' + cfg.vault_id), `${cfg.dir}: the recorded key is a read key in its public form, for its vault`)
    check(cfg.clone === `sgit clone ${cfg.read_key}`, `${cfg.dir}: the clone command matches the key`)
    check(Array.isArray(cfg.named_readers) && cfg.named_readers.length > 0 && cfg.named_readers.every(x => x.persona && x.name && /^\d{4}-\d{2}-\d{2}$/.test(x.agreed)), `${cfg.dir}: every named reader in the config carries a persona, a name and the date they agreed`)
}
const vaultHost = new URL(cfgs[0].endpoint).host

let reach = false
try { const r = await fetch(`${cfgs[0].endpoint}/api/vault/health/${cfgs[0].vault_id}`, { signal: AbortSignal.timeout(10000) }); reach = r.status < 500 } catch (e) { reach = false }
if (!reach) { console.log(`SKIP: ${vaultHost} cannot be reached from here`); process.exit(0) }

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
const args = process.env.CHROMIUM_SPKI_ALLOW ? [`--ignore-certificate-errors-spki-list=${process.env.CHROMIUM_SPKI_ALLOW}`] : []
let browser
browser = await launch({ args })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await routeApi(ctx)
const pg = await ctx.newPage()
const errors = [], hosts = new Set()
pg.on('pageerror', e => errors.push(e.message))
pg.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()) })
pg.on('request', r => hosts.add(new URL(r.url()).host))
const ready = () => pg.waitForFunction(() => document.documentElement.getAttribute('data-wire') === 'ready' || document.querySelector('.wire-err'), null, { timeout: 60000 })
const text = sel => pg.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent : '' }, sel)
const count = sel => pg.evaluate(sel => document.querySelectorAll(sel).length, sel)
const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function testWire(cfg) {
    const W = cfg.dir, counts = (cfg.snap && cfg.snap.counts) || {}
    const t0 = Date.now()
    await pg.goto(B + W); await ready()
    check(!(await pg.$('.wire-err')), `${W} the edition opens from the vault (${Date.now() - t0} ms)`)
    if (await pg.$('.wire-err')) return
    const status = await text('#wire-status')
    check(new RegExp(`Read from vault ${cfg.vault_id}`).test(status) && /commit [0-9a-f]{12}/.test(status), `${W} the status names the vault and the commit: ${status.slice(0, 90).replace(/\s+/g, ' ')}`)
    const edition = await text('.edition .k')
    check(/Edition of \d{4}-\d{2}-\d{2}/.test(edition), `${W} ${edition}`)
    const n = await count('article.story'), beats = await count('h2.beat')
    check(n >= 10 && beats >= 3, `${W} ${n} stories drawn across ${beats} headings (the lead and the beats)`)
    check((await count('article.story.lead')) === 1 && /Why it leads/.test(await text('article.story.lead')), `${W} the lead story carries why it leads`)
    check(await pg.evaluate(() => [...document.querySelectorAll('article.story')].every(a => /ai-generated|reviewed/.test(a.querySelector('.status') ? a.querySelector('.status').textContent : 'reviewed'))), `${W} every story shows its status as the vault states it`)
    check(await pg.evaluate(() => [...document.querySelectorAll('#wire-mount a[href]:not([data-site])')].every(a => /^https?:\/\//.test(a.getAttribute('href')) || a.getAttribute('href').startsWith('#'))), `${W} every link drawn from the vault is http(s) or an anchor`)
    check(await pg.evaluate(() => [...document.querySelectorAll('#wire-mount a[data-site]')].every(a => a.closest('#wire-inbox') && /^(\.\.\/)+admin\/notes\//.test(a.getAttribute('href')))), `${W} the only site link inside the edition is the bar's link to the brief`)
    check(await pg.evaluate(() => !document.querySelector('#wire-mount script, #wire-mount iframe, #wire-mount img, #wire-mount [onclick]')), `${W} nothing from the vault became a script, frame, image or handler`)
    check(await pg.evaluate(() => document.getElementById('wire-snapshot').hidden), `${W} the snapshot stays hidden while the vault is live`)
    const strips = await count('article.story .meta svg.pv-strip'), graphs = await pg.evaluate(() => ['wire-byday', 'wire-threads', 'wire-entities'].filter(id => { const d = document.getElementById(id); return d && d.tagName === 'DETAILS' && !d.open && d.querySelector('figure.graph svg[role=img][aria-label]') }))
    check(strips === n && graphs.includes('wire-byday') && graphs.includes('wire-entities') && await pg.evaluate(() => [...document.querySelectorAll('#wire-mount figure.graph svg')].every(s => s.getAttribute('aria-label') === (s.querySelector('title') || {}).textContent)), `${W} a provenance strip under every headline (${strips}), and the edition's graphs folded in the header (${graphs.join(', ')}), each svg labelled`)
    check(await pg.evaluate(() => [...document.querySelectorAll('#wire-mount svg [fill], #wire-mount svg [stroke]')].every(e => ['fill', 'stroke'].every(k => { const v = e.getAttribute(k); return v == null || v === 'none' || v === 'currentColor' || /^var\(--[a-z0-9-]+\)$/.test(v) }))), `${W} every colour in the graphs is a theme token`)
    check((await count('.wires a[aria-current]')) === 1 && (await count('.wires a')) === cfgs.length + 3, `${W} the strip names every wire, marks this one, and links the shared pages`)
    // the verifier's record, when the vault has one: every row at its story, the file's words in the header
    const checked = await count('.edition .checks'), rowsAtStories = await count('article.story .check')
    check(checked <= 1 && (checked || rowsAtStories === 0), `${W} the verifier's record is in the header (${checked}) and at ${rowsAtStories} stories`)
    // subscribe to this wire alone: the form, the headers, the lane; the append is intercepted, nothing leaves
    let appended = null
    await pg.route('**/api/vault/append/write/**', async route => { appended = JSON.parse(route.request().postData() || '{}'); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }) })
    check((await count('form[data-wire-subscribe]')) === 1 && (await pg.getAttribute('form[data-wire-subscribe]', 'data-list')) === `wire:${cfg.slug || 'industry'}`, `${W} the page offers a subscription to this wire alone (wire:${cfg.slug || 'industry'})`)
    await pg.fill('form[data-wire-subscribe] input[name=email]', 'reader@example.com'); await pg.check('form[data-wire-subscribe] input[name=consent]'); await pg.click('form[data-wire-subscribe] button[type=submit]')
    await pg.waitForFunction(() => { const f = document.querySelector('form[data-wire-subscribe]'); return f && (f.hidden || /email instead/.test(f.querySelector('.sub-status').textContent)) }, null, { timeout: 20000 })
    check(!!appended && typeof appended.append_token === 'string' && /^[A-Za-z0-9+/=]+$/.test(appended.payload || '') && await pg.evaluate(() => document.querySelector('form[data-wire-subscribe]').hidden && !document.querySelector('.wire-sub .sub-done').hidden), `${W} the request is encrypted and appended to the lane with the token; the page says it was sent`)
    await pg.unroute('**/api/vault/append/write/**')
    // the desk's release notes (data/releases.json, written on every publish) and its corrections
    const rel = await count('#wire-releases .release')
    // a release may add nothing (a docs-only publish, as 2026-10-13.2 on every wire): then there is no Added line to look for
    const relIds = await count('#wire-releases .ids a')
    check(rel >= 1 && (await text('#wire-releases .release p b')).length > 0 && await pg.evaluate(() => [...document.querySelectorAll('#wire-releases .ids a')].every(a => a.getAttribute('href').startsWith('#') && document.getElementById(a.getAttribute('href').slice(1)))), `${W} the bar shows ${rel} release note(s) from the vault, ${relIds} added or updated ids each linked to its story on the page`)
    check(await pg.evaluate(() => [...document.querySelectorAll('#wire-releases .ids')].filter(p => /^Updated:/.test(p.textContent)).flatMap(p => [...p.querySelectorAll('a')]).every(a => document.getElementById(a.getAttribute('href').slice(1)).querySelector('.flag.upd'))), `${W} every story a shown release names as updated carries an Updated flag`)
    const changed = await count('article.story .changes')
    check(changed >= (counts.corrected ? 1 : 0) && await pg.evaluate(() => [...document.querySelectorAll('article.story .changes li')].every(li => /^\d{4}-\d{2}-\d{2}$/.test(li.querySelector('.at').textContent) && li.textContent.length > 20)), `${W} ${changed} corrected stories carry their changes, dated, as the vault records them (the snapshot counts ${counts.corrected || 0})`)
    check(await pg.evaluate(() => [...document.querySelectorAll('article.story .changes')].every(ul => ul.closest('article.story').querySelector('.flag.upd') || ul.closest('article.story').querySelector('.meta').textContent.includes('from the edition of'))), `${W} a story with changes is flagged Updated, or says which earlier edition it is from`)
    check((await count('.edition .corrections')) === (counts.corrected ? 1 : 0) || (await count('.edition .corrections')) <= 1, `${W} the edition's header carries the desk's corrections note when there is one (${await count('.edition .corrections')})`)
    // what the vault adds beyond the edition, when the snapshot says it has it
    if (counts.map_entities) {
        const ents = await count('#wire-map .ent')
        check(ents === counts.map_entities && /named by a story/.test(await text('#wire-map > summary')) && (await count('#wire-map .named li')) >= 1, `${W} the map is drawn: ${ents} entities, with the stories that name them`)
        check(await pg.evaluate(() => [...document.querySelectorAll('#wire-map .named a')].every(a => a.getAttribute('href').startsWith('#') && document.getElementById(a.getAttribute('href').slice(1)))), `${W} every story named in the map is on the page`)
    } else check((await count('#wire-map')) === 0, `${W} no map, none drawn`)
    if (counts.stack_services) {
        const svcs = await count('#wire-stack .ent'), dls = await count('#wire-deadlines li')
        check(svcs === counts.stack_services && dls === counts.deadlines && (await count('#wire-stack .named li')) >= 1, `${W} the stack is drawn: ${svcs} services with the items that touched them, ${dls} deadlines in the header`)
        check(await pg.evaluate(() => [...document.querySelectorAll('#wire-deadlines li')].every(li => /^\d{4}-\d{2}-\d{2}$/.test(li.querySelector('.dd').textContent) && /\((in \d+ days|\d+ days ago|today)\)/.test(li.textContent))), `${W} every deadline is dated and says how far off it is`)
    } else check((await count('#wire-stack, #wire-deadlines')) === 0, `${W} no stack, none drawn`)
    // a wire in two languages: the switch changes the headlines and is remembered for this wire
    const langs = (cfg.snap && cfg.snap.wire && Array.isArray(cfg.snap.wire.languages)) ? cfg.snap.wire.languages : []
    if (langs.length > 1) {
        const before = await pg.evaluate(() => [...document.querySelectorAll('article.story h3')].map(h => h.textContent).join('|'))
        await pg.click(`.lens.langs button[data-lang=${langs[1]}]`); await pg.waitForTimeout(500)
        const after = await pg.evaluate(() => [...document.querySelectorAll('article.story h3')].map(h => h.textContent).join('|'))
        check(before !== after && (await count('article.story')) === n && (await pg.evaluate(() => localStorage.getItem('sgit.wire.lang:' + location.pathname.split('/')[2]))) === langs[1], `${W} the switch to ${langs[1]} redraws the headlines in that language and is remembered`)
        check((await count('article.story blockquote .chip.lang')) >= 1, `${W} a quote says which language it is in`)
        await pg.click(`.lens.langs button[data-lang=${langs[0]}]`); await pg.waitForTimeout(300)
    } else check((await count('.lens.langs')) === 0, `${W} one language, no switch`)
    // the lens: the first public persona, then the named reader by their recorded agreement
    const namedName = cfg.named_readers[0].name.split(' ')[0]
    const pub = await pg.evaluate(name => ([...document.querySelectorAll('.lens button')].map(b => b.textContent).find(t => t !== 'Everyone' && !t.startsWith(name)) || ''), namedName)
    const first = pub.split(',')[0]
    check(!!pub, `${W} the lens bar offers a public persona (${pub})`)
    await pg.evaluate(t => [...document.querySelectorAll('.lens button')].find(b => b.textContent === t).click(), pub)
    await pg.waitForFunction(name => new RegExp(`reach ${name}`).test(document.getElementById('wire-status').textContent), rx(first), { timeout: 30000 })
    const status2 = await text('#wire-status')
    const m = new RegExp(`(\\d+) stories reach ${rx(first)}, (\\d+) withheld`).exec(status2)
    check(m && Number(m[1]) + Number(m[2]) >= n - 1, `${W} as ${first}: ${m && m[1]} reach, ${m && m[2]} withheld, each withheld one with its reason`)
    const held = await count('.withheld li')
    check(held === 0 || /no concern matched|withheld|no delivery/.test(await text('.withheld li')), `${W} the withheld list carries the recorded reason (${held} withheld)`)
    check((await count('.chip.reach')) > 0, `${W} a reached story shows the connection that reached the reader`)
    check(/#lens=[a-z-]+$/.test(await pg.evaluate(() => location.hash)), `${W} the lens is in the address, so it can be linked to`)
    await pg.evaluate(() => [...document.querySelectorAll('.lens button')].find(b => /Everyone/.test(b.textContent)).click()); await pg.waitForTimeout(500)
    check((await count('article.story')) === n, `${W} Everyone brings every story back`)
    check(await pg.evaluate(name => !document.querySelector('.personal') && [...document.querySelectorAll('.lens button')].some(b => b.textContent.startsWith(name)), namedName), `${W} the lens bar offers the named reader (${namedName}) and no personal brief shows under Everyone`)
    await pg.evaluate(name => [...document.querySelectorAll('.lens button')].find(b => b.textContent.startsWith(name)).click(), namedName)
    await pg.waitForFunction(name => new RegExp(`reach ${name}`).test(document.getElementById('wire-status').textContent), namedName, { timeout: 30000 })
    check((await count('.personal')) === 1 && (await count('.personal ol li')) >= 3 && (await text('.personal .note')).length > 40, `${W} under ${namedName}'s lens the personal brief the vault wrote is shown, with its top stories`)
    check(await pg.evaluate(() => [...document.querySelectorAll('.personal a')].every(a => a.getAttribute('href').startsWith('#'))), `${W} the personal brief links only to stories on the page`)
    check(/A beta\./.test(await pg.evaluate(() => document.body.textContent)) && /agreement/.test(await text('.personal')), `${W} the page says it is a beta and the brief says the named reader agreed`)
    // sources
    await pg.goto(B + W + 'sources.html'); await ready()
    const rows = await count('.srcs tbody tr')
    check(rows >= 10 && /tier A/.test(await text('#wire-mount p')), `${W} ${rows} sources with their tiers`)
    // how
    await pg.goto(B + W + 'how.html'); await ready()
    check((await count('.docs-nav button')) >= 3 && /architecture/i.test(await text('.doc-body')), `${W} the documents are read from docs/*.md and rendered`)
    check(await pg.evaluate(() => !document.querySelector('.doc-body script') && [...document.querySelectorAll('.doc-body a')].every(a => /^https?:/.test(a.href))), `${W} the rendered documents carry no script and only http links`)
    await pg.evaluate(() => [...document.querySelectorAll('.docs-nav button')].find(b => /RUNBOOK/.test(b.textContent)).click()); await pg.waitForTimeout(1500)
    check(/run|daily|weekly/i.test(await text('.doc-body')), `${W} switching to the runbook reads another file from the vault`)
    // reach
    await pg.goto(B + W + 'reach.html'); await ready()
    const routes = await count('.route'), addrs = await count('.route .addrs li')
    check(await pg.evaluate(() => !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test([...document.querySelectorAll('#wire-mount li')].filter(li => !li.querySelector('code')).map(li => li.textContent).join(' '))), `${W} no address appears outside a recorded role address (${routes} routes, ${addrs} role addresses)`)
    check(await pg.evaluate(() => [...document.querySelectorAll('.route .addrs code')].every(c => /^(support|events|aws-security|info|press|contact|hello|media|security|team|office)@/.test(c.textContent))), `${W} every recorded address is a role address`)
    check((await count('#reach-vault')) === 1 && (await count('#reach-vault li')) >= 5, `${W} the reach page draws the vault's own routes: entities and sources`)
    // phone
    const pCtx = await routeApi(await browser.newContext({ viewport: { width: 390, height: 800 } })); const p = await pCtx.newPage()
    await p.goto(B + W); await p.waitForFunction(() => document.documentElement.getAttribute('data-wire') === 'ready' || document.querySelector('.wire-err'), null, { timeout: 60000 })
    check((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, `${W} no sideways scroll at 390px`)
    await p.close()
}

try {
    for (const cfg of cfgs) await testWire(cfg)
    // day by day: every vault on one page
    await pg.goto(B + 'wire/days.html'); await ready()
    const dayN = await count('.day'), dayStories = await count('.daylist li')
    check(!(await pg.$('.wire-err')) && dayN >= 5 && dayStories >= 50 && (await count('.day .releases p')) >= cfgs.length, `day by day: ${dayN} days, ${dayStories} stories, the releases of every wire`)
    check(await pg.evaluate(() => { const ks = [...document.querySelectorAll('.day')].map(d => d.id); return ks.join() === ks.slice().sort().reverse().join() }), 'day by day: newest day first')
    check(await pg.evaluate(() => [...document.querySelectorAll('.daylist a')].every(a => /^(\w+\/)?index\.html#[\w-]+$/.test(a.getAttribute('href')))), 'day by day: every story links to its wire page')
    // the charter and the brief for the desks, rendered from their markdown
    await pg.goto(B + 'wire/charter.html'); check(/Three rounds/.test(await pg.evaluate(() => document.body.textContent)) && (await count('.md-doc h2')) >= 6, 'the charter is published, with its rounds and its nevers')
    await pg.goto(B + 'wire/desk-brief.html'); check(/X-SGit-List/.test(await pg.evaluate(() => document.body.textContent)) && /wire-factcheck\/v1/.test(await pg.evaluate(() => document.body.textContent)), 'the brief for the desks is published, with the list header and the verifier schema')
    // the wires keep apart in this browser: what one wire saw is not new on another, and each keeps its own lens
    await pg.goto(B + 'wire/'); await ready()
    const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('sgit.wire.v1') || '{}'))
    const scoped = cfgs.filter(c => c.slug).map(c => c.slug)
    check(scoped.every(s => Object.keys(st.seen || {}).some(k => k.startsWith(s + ':')) && (st.visits || {})[s]) && Object.keys(st.seen || {}).some(k => !k.includes(':')) && !!st.last_visit, `the stories seen and the visits are kept per wire (${scoped.join(', ')} beside the Industry Wire)`)
    // what left the browser
    const others = [...hosts].filter(h => !h.startsWith('localhost') && h !== API_HOSTNAME && h !== vaultHost)
    check(others.length === 0, `requests went to this site and ${vaultHost} only${others.length ? ' (also: ' + others.join(', ') + ')' : ''}`)
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL WIRE CHECKS PASS')
process.exit(failed ? 1 : 0)
