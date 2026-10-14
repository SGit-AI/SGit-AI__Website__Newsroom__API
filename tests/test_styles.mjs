#!/usr/bin/env node
/* test_styles.mjs: the served stylesheets write no literal colour outside a theme token (the newsroom's card 038, as a gate).
 *
 *   node tests/test_styles.mjs
 *
 * The newsroom's five themes work by tokens (its assets/themes/themes.css); a stylesheet that writes a colour of its own ships
 * one panel that does not follow the theme, and nobody notices until a dark theme shows a light box. The newsroom's
 * test_themes.mjs holds the stylesheets that stay in that repository to this rule; this test holds the ones that moved here
 * (the current meter's, the vault pane's, search's, the wire's, the reading-list pages' and the passkey lab's) to the same
 * rule, with the same list of signals that stay literal on purpose: the vault button's dots, the wire's amber "new" flag
 * and its ink, the terminal panel and its text, the print page, and the meter's neutral fallbacks inside var(), which the
 * token overrides. The frozen meter copies (v1.0.0 to v1.4.0) are history and are not held to it.
 *
 * Node only: no browser, no network.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SERVED = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/served.json'), 'utf8'))
const ALLOWED = /#(b8bcc4|8be0c2|f0a020|f0c070|ffd38a|14161a|a6e3c3|e6e8ec|1c1d21|0d1117|c9d1d9|3fb950|d29922|fff)\b/
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

const meters = SERVED.filter(p => /sg-meter\.css$/.test(p))
const newest = meters.map(p => p.split('/').at(-2)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)
const OWN = SERVED.filter(p => p.endsWith('.css') && (!/sg-meter\//.test(p) || p.includes(`/${newest}/`)) && !p.includes('/vendor/'))
check(OWN.length >= 7, `${OWN.length} stylesheets are held to the rule (the meter's is ${newest})`)
for (const rel of OWN) {
    const t = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const literals = [...t.matchAll(/var\([^)]*\)|(#[0-9a-fA-F]{3,8}\b)/g)].map(m => m[1]).filter(Boolean).filter(h => !ALLOWED.test(h))
    check(literals.length === 0, `${rel}: no literal colour outside a token${literals.length ? ' (' + [...new Set(literals)].join(' ') + ')' : ''}`)
}
console.log(failed ? `${failed} FAILED` : 'ALL STYLE CHECKS PASS')
process.exit(failed ? 1 : 0)
