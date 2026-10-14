/* harness.mjs: what every test here shares.
 *
 * The reader code lives in this repository and is served from https://api.newsroom.sgit.ai/<release>/<path>.
 * The pages that run it live in the newsroom (SGit-AI/SGit-AI__Website__Newsroom) and import it from that host.
 * A test therefore has two trees:
 *
 *   API   this repository: the files the browser runs, at their served paths (tools/served.json lists them)
 *   SITE  a checkout of the newsroom: the pages, the content data (articles/ids.json, graphs.json, search/*.json)
 *         and the build code the pages come from. NEWSROOM=<path> names it; the default is .newsroom/ beside this
 *         file's parent (CI checks the newsroom out there, at the ref in tests/newsroom.json).
 *
 * A browser test serves SITE on a local port, as the newsroom's tests always did, and routes every request for
 * https://api.newsroom.sgit.ai/v*.*.*\/<path> to API/<path> in this working tree, with the CORS header GitHub Pages
 * sends. So the page is the real page, the code is the code under test, and nothing is mocked but the host name.
 *
 * BROWSER=chromium|webkit|firefox picks the engine (chromium by default). A test that needs CDP (the virtual
 * authenticator) says so with needsChromium().
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

export const API = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
export const SITE = process.env.NEWSROOM ? path.resolve(process.env.NEWSROOM) : path.join(API, '.newsroom')
export const API_HOSTNAME = 'api.newsroom.sgit.ai'
export const API_HOST = `https://${API_HOSTNAME}`
export const RELEASE = JSON.parse(fs.readFileSync(path.join(API, 'tools/version.json'), 'utf8')).release
export const SERVED = new Set(JSON.parse(fs.readFileSync(path.join(API, 'tools/served.json'), 'utf8')))
export const isApi = rel => SERVED.has(rel.replace(/^\.?\//, ''))
export const apiUrl = rel => `${API_HOST}/${RELEASE}/${rel}`
export const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                       '.tpl': 'text/plain', '.md': 'text/markdown', '.txt': 'text/plain', '.webp': 'image/webp', '.jpg': 'image/jpeg',
                       '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml' }
const CORS = { 'access-control-allow-origin': '*' }

if (!fs.existsSync(path.join(SITE, 'index.html'))) {
    console.log(`SKIP: the newsroom's pages are not at ${SITE}; set NEWSROOM=<a checkout of SGit-AI/SGit-AI__Website__Newsroom>`)
    process.exit(0)
}

/** Every API file a page asked for, as <release>/<path>; a test can check that the reader code came from the host. */
export const apiHits = []

/** Route the API host to this working tree, for one browser context; and a served path asked for on the local site origin
 *  (a test's in-page import('/assets/newsroom-vault.js')) is answered from this tree too, since the newsroom no longer holds it. */
export async function routeApi(ctx) {
    await ctx.route(u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u.href) && SERVED.has(decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0])), route => {
        const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\//, '').split('?')[0])
        const f = path.join(API, rel)
        apiHits.push(`site/${rel}`)
        return route.fulfill({ status: 200, headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', ...CORS }, body: fs.readFileSync(f) })
    })
    await ctx.route(`${API_HOST}/**`, route => {
        const u = new URL(route.request().url())
        const m = /^\/(v\d+\.\d+\.\d+)\/(.+)$/.exec(u.pathname)
        const rel = m ? decodeURIComponent(m[2]) : null
        const f = rel ? path.join(API, rel) : ''
        if (!m || !f.startsWith(API) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
            return route.fulfill({ status: 404, headers: CORS, body: '' })
        }
        apiHits.push(`${m[1]}/${rel}`)
        return route.fulfill({ status: 200, headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', ...CORS }, body: fs.readFileSync(f) })
    })
    return ctx
}

let pw = null
async function playwright() {
    if (pw) return pw
    try { pw = await import('playwright') } catch (e) {
        try { const g = execSync('npm root -g').toString().trim(); pw = await import(path.join(g, 'playwright', 'index.mjs')) }
        catch (e2) { console.log('SKIP: playwright is not installed'); process.exit(0) }
    }
    return pw
}

export const engine = process.env.BROWSER || 'chromium'

/** The clipboard: only Chromium grants clipboard-read and clipboard-write (Firefox and WebKit refuse the names), so a
 *  test grants them there and reads the clipboard back there; elsewhere it checks what it can see on the page. */
export const CLIPBOARD = engine === 'chromium' ? ['clipboard-read', 'clipboard-write'] : []
export const canReadClipboard = engine === 'chromium'
export async function clipboard(ctx) { if (canReadClipboard) await ctx.grantPermissions(CLIPBOARD) }

/** A test that drives CDP (the virtual authenticator) runs in Chromium only; elsewhere it says so and passes. */
export function needsChromium(why) {
    if (engine !== 'chromium') { console.log(`SKIP: ${why || 'this test'} needs Chromium; BROWSER=${engine}`); process.exit(0) }
}

/** Launch the engine BROWSER names, with the newsroom's fallback to the pre-installed Chromium. */
export async function launch(opts = {}) {
    const p = await playwright()
    const t = p[engine]
    if (!t) { console.log(`SKIP: no browser engine named ${engine}`); process.exit(0) }
    try { return await t.launch(opts) } catch (e) {
        if (engine === 'chromium') {
            try { return await t.launch({ ...opts, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }) } catch (e2) { /* below */ }
        }
        console.log(`SKIP: ${engine} is not available`); process.exit(0)
    }
}
