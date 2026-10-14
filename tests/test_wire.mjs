#!/usr/bin/env node
/* test_wire.mjs: the Industry Wire pages in Chromium, reading the real vault.
 *
 *   node admin/build/test_wire.mjs
 *
 * No stand-in: the brief's rule is that a test that needs a vault uses a vault, and this one is public by its read
 * key. It opens the three wire pages, checks that the edition, the lens, the sources and the documents are read and
 * drawn, that nothing is run from the vault and no request goes anywhere but this site and the vault server, and
 * that the pages hold at phone width. Skips (exit 0) when Playwright or Chromium is missing, or when the vault
 * server cannot be reached from here, and says which.
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

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium } from './harness.mjs'
const ROOT = SITE
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin/build/wire-vault.json'), 'utf8'))
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

check(/^sgit_public_read_[0-9a-f]{64}:[a-z0-9]{4,24}$/.test(cfg.read_key), 'the recorded key is a read key in its public form')
check(cfg.clone === `sgit clone ${cfg.read_key}`, 'the clone command matches the key')
check(Array.isArray(cfg.named_readers) && cfg.named_readers.length > 0 && cfg.named_readers.every(x => x.persona && x.name && /^\d{4}-\d{2}-\d{2}$/.test(x.agreed)), 'every named reader in the config carries a persona, a name and the date they agreed')
const vaultHost = new URL(cfg.endpoint).host

let reach = false
try { const r = await fetch(`${cfg.endpoint}/api/vault/health/${cfg.vault_id}`, { signal: AbortSignal.timeout(10000) }); reach = r.status < 500 } catch (e) { reach = false }
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

try {
    const t0 = Date.now()
    await pg.goto(B + 'wire/'); await ready()
    check(!(await pg.$('.wire-err')), `the edition opens from the vault (${Date.now() - t0} ms)`)
    const status = await text('#wire-status')
    check(/Read from vault u9i9jp0l/.test(status) && /commit [0-9a-f]{12}/.test(status), `the status names the vault and the commit: ${status.slice(0, 90).replace(/\s+/g, ' ')}`)
    const edition = await text('.edition .k')
    check(/Edition of \d{4}-\d{2}-\d{2}/.test(edition), edition)
    const n = await count('article.story'), beats = await count('h2.beat')
    check(n >= 30 && beats >= 5, `${n} stories drawn across ${beats} headings (the lead and the beats)`)
    check((await count('article.story.lead')) === 1 && /Why it leads/.test(await text('article.story.lead')), 'the lead story carries why it leads')
    check(await pg.evaluate(() => [...document.querySelectorAll('article.story')].every(a => /ai-generated|reviewed/.test(a.querySelector('.status') ? a.querySelector('.status').textContent : 'reviewed'))), 'every story shows its status as the vault states it')
    check(await pg.evaluate(() => [...document.querySelectorAll('#wire-mount a[href]:not([data-site])')].every(a => /^https?:\/\//.test(a.getAttribute('href')) || a.getAttribute('href').startsWith('#'))), 'every link drawn from the vault is http(s) or an anchor')
    check(await pg.evaluate(() => [...document.querySelectorAll('#wire-mount a[data-site]')].every(a => a.closest('#wire-inbox') && /^\.\.\/admin\/notes\//.test(a.getAttribute('href')))), 'the only site link inside the edition is the bar\'s link to the brief')
    check(await pg.evaluate(() => !document.querySelector('#wire-mount script, #wire-mount iframe, #wire-mount img, #wire-mount [onclick]')), 'nothing from the vault became a script, frame, image or handler')
    check(await pg.evaluate(() => document.getElementById('wire-snapshot').hidden), 'the snapshot stays hidden while the vault is live')
    // the lens
    await pg.evaluate(() => [...document.querySelectorAll('.lens button')].find(b => /Sam/.test(b.textContent)).click())
    await pg.waitForFunction(() => /reach Sam/.test(document.getElementById('wire-status').textContent), null, { timeout: 30000 })
    const reached = await count('article.story:not(.lead)'), held = await count('.withheld li')
    const status2 = await text('#wire-status')
    const m = /(\d+) stories reach Sam, (\d+) withheld/.exec(status2)
    check(m && Number(m[1]) + Number(m[2]) >= 30, `as Sam: ${m && m[1]} reach, ${m && m[2]} withheld, each withheld one with its reason`)
    check(held > 0 && /no concern matched|withheld/.test(await text('.withheld li')), 'the withheld list carries the recorded reason')
    check((await count('.chip.reach')) > 0, 'a reached story shows the connection that reached the reader')
    check(/#lens=security-lead$/.test(await pg.evaluate(() => location.hash)), 'the lens is in the address, so it can be linked to')
    await pg.evaluate(() => [...document.querySelectorAll('.lens button')].find(b => /Everyone/.test(b.textContent)).click()); await pg.waitForTimeout(500)
    check((await count('article.story')) === n, 'Everyone brings every story back')
    // the named reader, by their recorded agreement
    const namedName = cfg.named_readers[0].name.split(' ')[0]
    check(await pg.evaluate(name => !!document.querySelector('.personal') === false && [...document.querySelectorAll('.lens button')].some(b => b.textContent.startsWith(name)), namedName), `the lens bar offers the named reader (${namedName}) and no personal brief shows under Everyone`)
    await pg.evaluate(name => [...document.querySelectorAll('.lens button')].find(b => b.textContent.startsWith(name)).click(), namedName)
    await pg.waitForFunction(name => new RegExp(`reach ${name}`).test(document.getElementById('wire-status').textContent), namedName, { timeout: 30000 })
    check((await count('.personal')) === 1 && (await count('.personal ol li')) >= 3 && (await text('.personal .note')).length > 40, `under ${namedName}'s lens the personal brief the vault wrote is shown, with its top stories`)
    check(await pg.evaluate(() => [...document.querySelectorAll('.personal a')].every(a => a.getAttribute('href').startsWith('#'))), 'the personal brief links only to stories on the page')
    check(/A beta\./.test(await pg.evaluate(() => document.body.textContent)) && /agreement/.test(await text('.personal')), 'the page says it is a beta and the brief says the named reader agreed')
    // sources
    await pg.goto(B + 'wire/sources.html'); await ready()
    const rows = await count('.srcs tbody tr')
    check(rows >= 40 && /tier A/.test(await text('#wire-mount p')), `${rows} sources with their tiers`)
    // how
    await pg.goto(B + 'wire/how.html'); await ready()
    check((await count('.docs-nav button')) >= 5 && /architecture/i.test(await text('.doc-body')), 'the documents are read from docs/*.md and rendered')
    check(await pg.evaluate(() => !document.querySelector('.doc-body script') && [...document.querySelectorAll('.doc-body a')].every(a => /^https?:/.test(a.href))), 'the rendered documents carry no script and only http links')
    await pg.evaluate(() => [...document.querySelectorAll('.docs-nav button')].find(b => /RUNBOOK/.test(b.textContent)).click()); await pg.waitForTimeout(1500)
    check(/daily|run/i.test(await text('.doc-body')), 'switching to the runbook reads another file from the vault')
    // what left the browser
    const others = [...hosts].filter(h => !h.startsWith('localhost') && h !== API_HOSTNAME && h !== vaultHost)
    check(others.length === 0, `requests went to this site and ${vaultHost} only${others.length ? ' (also: ' + others.join(', ') + ')' : ''}`)
    // phone
    const pCtx = await routeApi(await browser.newContext({ viewport: { width: 390, height: 800 } })); const p = await pCtx.newPage()
    await p.goto(B + 'wire/'); await p.waitForFunction(() => document.documentElement.getAttribute('data-wire') === 'ready' || document.querySelector('.wire-err'), null, { timeout: 60000 })
    check((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at 390px')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
    await browser.close()
    server.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL WIRE CHECKS PASS')
process.exit(failed ? 1 : 0)
