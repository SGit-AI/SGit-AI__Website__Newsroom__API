/**
 * search.js: the newsroom searched in the reader's browser.
 *
 * The index is two files built at release time by admin/build/search_index.py from the published pages:
 *   search/docs.json   one entry per page: u address, t title, k kind, n article number, d date, x teaser, tp topics,
 *                      tg tags, g the article graph's core idea and node labels, h headings [anchor, text]
 *   search/text.json   paragraphs: [doc, anchor, text] and, for wording that is only in an earlier version of an
 *                      article, [doc, anchor, text, version, the version page that shows the change]
 *
 * Ranking is BM25 over two kinds of unit: one per page made of its fields, weighted (title 5, tags and topics 3,
 * graph and teaser and headings 2), and one per paragraph. A page's score is its fields plus its best paragraphs,
 * scaled by how many of the query's words it has at all, so a page with every word beats a page with one word many
 * times. "Quotes" require the exact phrase. A number alone is that article. The last word is also read as a prefix,
 * so results come as you type. Words are folded (case, accents) and lightly stemmed (agents, agent; thinking, think).
 *
 * The functions above mountSearch are pure and run in Node (admin/build/test_search.mjs). Nothing is sent anywhere:
 * the two files are fetched from this site and everything else happens in this page.
 *
 * @module search
 */

const STOP = new Set(('a an and are as at be but by for from has have had i in is it its of on or that the this to was were will with not no do does did ' +
    'you your we our they their he she his her them what which who whom how why when where than then so if into about over under after before can could ' +
    'would should may might there here these those been being also just only more most very').split(' '))
export const WEIGHTS = { t: 5, tags: 3, g: 2, x: 2, h: 2 }
const K1 = 1.2, B = 0.75
const KIND_BOOST = { article: 1.15, story: 1.0, newsletter: 1.0, desk: 1.0, collection: 0.95, deck: 0.95, view: 0.9, wire: 0.95, page: 0.9, engineering: 0.85, note: 0.85, newsroom: 0.85, account: 0.8, admin: 0.75, lab: 0.85, vault: 0.85, archive: 0.6 }
export const GROUPS = [
    ['all', 'Everything', null],
    ['articles', 'Articles', ['article', 'newsletter', 'desk', 'collection', 'deck', 'view']],
    ['wire', 'The wire', ['story', 'wire']],
    ['engineering', 'Engineering', ['engineering', 'note', 'admin']],
    ['pages', 'Pages', ['page', 'newsroom', 'account', 'lab', 'vault']],
    ['archive', 'Archive', ['archive']],
]

export const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const words = s => fold(s).match(/[a-z0-9]+/g) || []
export function stem(w) {
    if (w.length <= 3 || /^\d+$/.test(w)) return w
    if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y'
    else if (w.endsWith('sses')) w = w.slice(0, -2)
    else if (/(ss|us|is)$/.test(w)) { /* keep */ }
    else if (/(ch|sh|x|z)es$/.test(w)) w = w.slice(0, -2)
    else if (w.endsWith('s')) w = w.slice(0, -1)
    if (w.endsWith('ing') && w.length > 5) { w = w.slice(0, -3); if (/([^lsz])\1$/.test(w)) w = w.slice(0, -1) }
    else if (w.endsWith('ed') && w.length > 4) { w = w.slice(0, -2); if (/([^lsz])\1$/.test(w)) w = w.slice(0, -1) }
    else if (w.endsWith('ly') && w.length > 5) w = w.slice(0, -2)
    if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1)
    return w
}
export const terms = s => words(s).map(stem)
const phraseKey = s => words(s).join(' ')

function tfOf(pairs) {
    const tf = new Map()
    let len = 0
    for (const [text, w] of pairs) for (const t of terms(text)) { tf.set(t, (tf.get(t) || 0) + w); len += w }
    return { tf, len }
}

/** The index from docs.json, and later the paragraphs from text.json (addText). */
export function buildIndex(docsFile) {
    const docs = docsFile.docs || []
    const units = [], df = new Map(), vocab = new Map()
    for (const d of docs) {
        const pairs = [[d.t, WEIGHTS.t], [[...(d.tg || []), ...(d.tp || [])].join(' ').replace(/-/g, ' '), WEIGHTS.tags], [d.g || '', WEIGHTS.g], [d.x || '', WEIGHTS.x], [(d.h || []).map(h => h[1]).join(' '), WEIGHTS.h]]
        const { tf, len } = tfOf(pairs)
        units.push({ doc: d.i, meta: true, tf, len, key: phraseKey([d.t, d.x].join(' ')) })
    }
    const ix = { docs, units, df, vocab, metaLen: 0, textLen: 0, nText: 0, hasText: false }
    recount(ix)
    return ix
}
export function addText(ix, textFile) {
    for (const c of textFile.chunks || []) {
        const { tf, len } = tfOf([[c[2], 1]])
        ix.units.push({ doc: c[0], meta: false, anchor: c[1], text: c[2], ver: c[3] || null, vurl: c[4] || null, tf, len })
    }
    ix.hasText = true
    recount(ix)
    return ix
}
function recount(ix) {
    ix.df.clear(); ix.vocab.clear()
    let ml = 0, mn = 0, tl = 0, tn = 0
    for (const u of ix.units) {
        for (const t of u.tf.keys()) { ix.df.set(t, (ix.df.get(t) || 0) + 1) }
        if (u.meta) { ml += u.len; mn++ } else { tl += u.len; tn++ }
    }
    for (const [t, n] of ix.df) ix.vocab.set(t, n)
    ix.metaLen = mn ? ml / mn : 1; ix.textLen = tn ? tl / tn : 1; ix.nText = tn
}

/** The query: words (stemmed, stop words dropped unless that is all there is), "phrases", a number, the last word as a prefix. */
export function parseQuery(q) {
    const raw = String(q || '')
    const phrases = [...raw.matchAll(/"([^"]+)"/g)].map(m => phraseKey(m[1])).filter(Boolean)
    const rest = raw.replace(/"[^"]*"?/g, ' ')
    const ws = words(rest)
    let kept = ws.filter(w => !STOP.has(w))
    if (!kept.length && !phrases.length) kept = ws
    const num = /^\s*#?(\d{1,4})\s*$/.exec(raw)
    const open = ws.length && !/[\s"]$/.test(raw)          // the last word is still being typed
    // soft phrases: not required, but a paragraph that has them counts for more: the whole query when it has two words or
    // more, and anything typed as one token that is really several (an address, a domain, a version: agent@riskmandate.ai)
    const soft = [...new Set([ws.length >= 2 ? ws.join(' ') : '', ...rest.split(/\s+/).filter(x => /[\p{L}\p{N}][@.\/][\p{L}\p{N}]/u.test(x)).map(phraseKey)].filter(x => x && x.includes(' ')))]
    return { phrases, soft, words: kept, terms: [...new Set(kept.map(stem))], number: num ? Number(num[1]) : null, prefix: open ? ws[ws.length - 1] : null }
}

function expand(ix, q) {
    // each query term, with the vocabulary terms it may stand for: itself, and for the word being typed, words it begins
    return q.terms.map(t => {
        const forms = new Map([[t, 1]])
        if (q.prefix && stem(q.prefix) === t && q.prefix.length >= 3) {
            const cands = [...ix.vocab.entries()].filter(([v]) => v !== t && (v.startsWith(q.prefix) || v.startsWith(t))).sort((a, b) => b[1] - a[1]).slice(0, 24)
            for (const [v] of cands) forms.set(v, 0.7)
        }
        return forms
    })
}
const idf = (ix, t) => { const n = ix.units.length, d = ix.df.get(t) || 0; return Math.log(1 + (n - d + 0.5) / (d + 0.5)) }
function unitScore(ix, u, groups) {
    let s = 0, found = 0
    const avg = u.meta ? ix.metaLen : ix.textLen
    for (const forms of groups) {
        let best = 0
        for (const [t, w] of forms) {
            const f = u.tf.get(t); if (!f) continue
            const v = w * idf(ix, t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * u.len / avg))
            if (v > best) best = v
        }
        if (best > 0) found++
        s += best
    }
    return { s, found }
}

/** Ranked results: [{ doc, score, unit (the best paragraph, or null), found, total, inVersion }]. */
export function search(ix, query, { group = 'all', limit = 50 } = {}) {
    const q = typeof query === 'string' ? parseQuery(query) : query
    const kinds = (GROUPS.find(g => g[0] === group) || GROUPS[0])[2]
    const inGroup = d => !kinds || kinds.includes(d.k)
    if (q.number != null) {
        const d = ix.docs.find(d => d.n === q.number && d.k === 'article')
        if (d && inGroup(d)) return [{ doc: d, score: 1e6, unit: null, found: 1, total: 1, inVersion: false, byNumber: true }]
    }
    if (!q.terms.length && !q.phrases.length) return []
    const groups = expand(ix, q)
    const per = new Map()                 // doc -> { meta, texts: [[score, unit]], found: Set, phrase: Set }
    const entry = i => { let e = per.get(i); if (!e) { e = { meta: 0, texts: [], found: new Set(), phrase: new Set(), phraseUnit: null }; per.set(i, e) } return e }
    for (const u of ix.units) {
        const d = ix.docs[u.doc]
        if (!d || !inGroup(d)) continue
        const r = groups.length ? unitScore(ix, u, groups) : { s: 0, found: 0 }
        let ph = 0, sp = 0
        if (q.phrases.length || (q.soft && q.soft.length)) {
            const key = u.meta ? u.key : (u.key || (u.key = phraseKey(u.text)))
            for (const p of q.phrases) if (key.includes(p)) ph++
            for (const p of q.soft || []) if (key.includes(p)) sp++
        }
        if (r.s <= 0 && !ph) continue
        const e = entry(u.doc)
        groups.forEach((forms, gi) => { for (const t of forms.keys()) if (u.tf.has(t)) { e.found.add(gi); break } })
        if (ph) for (const p of q.phrases) if ((u.meta ? u.key : u.key).includes(p)) e.phrase.add(p)
        const s = (r.s + sp * 4) * (u.ver ? 0.6 : 1) + ph * 8
        if (u.meta) e.meta = Math.max(e.meta, s)
        else { e.texts.push([s, u]); if (ph && (!e.phraseUnit || (e.phraseUnit.ver && !u.ver))) e.phraseUnit = u }
    }
    const total = groups.length
    const out = []
    for (const [i, e] of per) {
        if (q.phrases.length && e.phrase.size < q.phrases.length) continue          // every phrase, or nothing
        const d = ix.docs[i]
        e.texts.sort((a, b) => b[0] - a[0])
        const t = e.texts.map(x => x[0])
        const cover = total ? e.found.size / total : 1
        if (total > 1 && cover < 0.5 && !q.phrases.length) continue
        const score = (e.meta + (t[0] || 0) + 0.3 * ((t[1] || 0) + (t[2] || 0))) * cover * cover * (KIND_BOOST[d.k] || 0.9)
        const unit = e.phraseUnit || (e.texts[0] ? e.texts[0][1] : null)
        out.push({ doc: d, score, unit, found: e.found.size, total, inVersion: !!(unit && unit.ver) && (q.phrases.length ? !e.texts.some(([, u]) => !u.ver && q.phrases.every(p => u.key && u.key.includes(p))) : false) })
    }
    out.sort((a, b) => b.score - a.score || String(b.doc.d || '').localeCompare(String(a.doc.d || '')))
    return out.slice(0, limit)
}

/** A window of the paragraph around the first match, and the spans to mark: [[text, marked]]. */
export function snippet(text, query, width = 260) {
    const q = typeof query === 'string' ? parseQuery(query) : query
    const stems = new Set(q.terms), pre = q.prefix && q.prefix.length >= 3 ? q.prefix : null
    const t = String(text || '')
    const toks = [...t.matchAll(/[\p{L}\p{N}]+/gu)]
    const hit = m => { const w = fold(m[0]); const s = stem(w); return stems.has(s) || (pre && w.startsWith(pre)) }
    // phrases: mark the run of words that matches
    const marks = new Array(toks.length).fill(false)
    for (const p of q.phrases) {
        const pw = p.split(' ')
        for (let i = 0; i + pw.length <= toks.length; i++) if (pw.every((w, j) => fold(toks[i + j][0]) === w)) for (let j = 0; j < pw.length; j++) marks[i + j] = true
    }
    toks.forEach((m, i) => { if (hit(m)) marks[i] = true })
    const first = marks.indexOf(true)
    let start = 0, end = t.length
    if (t.length > width) {
        const at = first >= 0 ? toks[first].index : 0
        start = Math.max(0, at - Math.floor(width / 3)); end = Math.min(t.length, start + width)
        if (start > 0) { const sp = t.indexOf(' ', start); if (sp > 0 && sp < at) start = sp + 1 }
        if (end < t.length) { const sp = t.lastIndexOf(' ', end); if (sp > start) end = sp }
    }
    const parts = []
    let pos = start
    toks.forEach((m, i) => {
        if (!marks[i] || m.index < start || m.index + m[0].length > end) return
        if (m.index > pos) parts.push([t.slice(pos, m.index), false])
        parts.push([m[0], true]); pos = m.index + m[0].length
    })
    if (pos < end) parts.push([t.slice(pos, end), false])
    if (start > 0) parts.unshift(['… ', false])
    if (end < t.length) parts.push([' …', false])
    // join marked words separated only by spaces or punctuation inside a phrase, so a phrase reads as one mark
    const out = []
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i], last = out[out.length - 1]
        if (last && last[1] && p[1]) last[0] += p[0]
        else if (last && last[1] && !p[1] && /^[\s@.\/'-]{1,3}$/.test(p[0]) && parts[i + 1] && parts[i + 1][1]) last[0] += p[0]
        else out.push([...p])
    }
    return out
}

// ------------------------------------------------------------ the page
const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v) }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}
const KIND_LABEL = { article: 'Article', newsletter: 'Newsletter', desk: 'From the desk', collection: 'Collection', deck: 'Deck', view: 'A reader\'s view', story: 'Wire story', wire: 'The wire', engineering: 'Engineering', note: 'Note', admin: 'Admin', page: 'Page', newsroom: 'How it runs', account: 'Account', lab: 'Lab', vault: 'Vault', archive: 'Archive' }
const EXAMPLES = ['agent@riskmandate.ai', '"deserves a proper answer"', '"I have not stopped thinking about"', 'passkey PRF door', 'GitHub Pages', 'Wardley map', '97']

export async function mountSearch(mount) {
    const ROOT = new URL(document.documentElement.getAttribute('data-root') || '', document.baseURI)   // the page's site root; the code is served from api.newsroom.sgit.ai
    const CODE = new URL('../../', import.meta.url)
    const input = mount.querySelector('#search-q'), status = mount.querySelector('#search-status'), list = mount.querySelector('#search-results'), filters = mount.querySelector('#search-filters')
    const form = mount.querySelector('form')
    const params = new URLSearchParams(location.search)
    let group = GROUPS.some(g => g[0] === params.get('f')) ? params.get('f') : 'all'
    let hideDone = params.get('done') === 'hide'
    input.value = params.get('q') || ''
    let ix = null
    // the reader's own records, when the vault pane's modules are there: what was read, what was marked done
    let R = null, N = null
    try { R = await import(new URL('assets/vault-pane/reading.js', CODE).href); N = await import(new URL('assets/vault-pane/notes.js', CODE).href) } catch (e) { R = N = null }
    function drawFilters(counts) { filters.replaceChildren(
        ...GROUPS.map(([k, label]) => h('button', { type: 'button', class: 'btn sm', 'data-group': k, 'aria-pressed': String(group === k), onclick: () => { group = k; sync(); draw() } }, counts ? `${label} (${counts[k] || 0})` : label)),
        N ? h('label', { class: 'hide-done' }, (() => { const c = h('input', { type: 'checkbox', id: 'search-hide-done' }); c.checked = hideDone; c.addEventListener('change', () => { hideDone = c.checked; sync(); draw() }); return c })(), ' Hide what I marked done') : null) }
    function sync() {
        const p = new URLSearchParams(); if (input.value.trim()) p.set('q', input.value.trim()); if (group !== 'all') p.set('f', group); if (hideDone) p.set('done', 'hide')
        try { history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname) } catch (e) { /* fine */ }
    }
    let timer = null
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { sync(); draw() }, 120) })
    form.addEventListener('submit', e => { e.preventDefault(); sync(); draw() })

    function badges(d) {
        if (!R || !N) return null
        const path = '/' + d.u.replace(/#.*$/, '')
        const story = d.k === 'story' ? d.u.split('#')[1] : null
        const dec = story ? (N.forStory('/wire/', story)[0] || N.forStory('/wire/index.html', story)[0] || null) : N.decisionFor(path)
        const s = story ? null : R.summary(path)
        return [dec ? h('span', { class: `badge ${dec.kind}` }, N.kindLabel(dec.kind)) : null, s ? h('span', { class: 'badge read' }, `Read · you ${R.depthWords(s.depth)}`) : null]
    }
    function isDone(d) { if (!N) return false; if (d.k === 'story') { const st = d.u.split('#')[1]; const n = N.forStory('/wire/', st)[0] || N.forStory('/wire/index.html', st)[0]; return !!n && n.kind === 'done' } return N.isDone('/' + d.u) }

    function draw() {
        if (!ix) return
        const q = parseQuery(input.value)
        if (!input.value.trim()) {
            drawFilters(null)
            list.replaceChildren(h('li', { class: 'tips' }, h('p', {}, 'Try: ', ...EXAMPLES.flatMap((x, i) => [i ? ' · ' : '', h('a', { href: `?q=${encodeURIComponent(x)}`, onclick: e => { e.preventDefault(); input.value = x; sync(); draw() } }, x)])),
                h('p', { class: 'dim' }, 'Words find pages that have them, titles and tags first; "quotes" find an exact phrase, including wording an article had in an earlier version; a number alone is that article.')))
            mount.dataset.results = '0'
            return
        }
        const counts = {}
        for (const [k] of GROUPS) counts[k] = search(ix, q, { group: k, limit: 500 }).filter(r => !(hideDone && isDone(r.doc))).length
        drawFilters(counts)
        let res = search(ix, q, { group, limit: 60 })
        if (hideDone) res = res.filter(r => !isDone(r.doc))
        mount.dataset.results = String(res.length)
        if (!res.length) { list.replaceChildren(h('li', { class: 'none' }, ix.hasText ? 'Nothing found. Fewer words, or a different one, may find it.' : 'Nothing in titles, tags or graphs; the full text is still loading.')); return }
        list.replaceChildren(...res.map(r => {
            const d = r.doc, u = r.unit
            const href = new URL(u && u.ver && r.inVersion ? u.vurl : (d.u + (u && u.anchor && !d.u.includes('#') ? `#${u.anchor}` : '')), ROOT).href
            const where = u && u.anchor && d.h ? (d.h.find(x => x[0] === u.anchor) || [])[1] : null
            return h('li', { class: `result kind-${d.k}`, 'data-u': d.u },
                h('p', { class: 'meta' }, h('span', { class: 'kind' }, KIND_LABEL[d.k] || d.k), d.n ? ` · No. ${d.n}` : '', d.d ? ` · ${d.d}` : '', where ? ` · ${where}` : '', badges(d)),
                h('h3', {}, h('a', { href }, d.t)),
                u ? h('p', { class: 'snip' }, u.ver ? h('span', { class: 'ver' }, `In ${u.ver}, since changed: `) : null, ...snippet(u.text, q).map(([s, m]) => m ? h('mark', {}, s) : s))
                  : (d.x ? h('p', { class: 'snip' }, d.x) : null),
                r.byNumber ? h('p', { class: 'dim' }, 'Article number ', String(d.n), '.') : null)
        }))
    }
    const t0 = performance.now()
    try {
        const docs = await (await fetch(new URL('search/docs.json', ROOT).href)).json()
        ix = buildIndex(docs)
        mount._search = { ix }                                              // for Ask (ask.js): the same index, filled in as the text arrives
        status.textContent = `${docs.docs.length} pages: titles, tags and article graphs searched; loading the full text…`
        draw()
        const text = await (await fetch(new URL('search/text.json', ROOT).href)).json()
        addText(ix, text)
        status.dataset.ready = 'full'
        status.textContent = `${docs.docs.length} pages and ${text.chunks.length.toLocaleString()} paragraphs, release ${docs.release}, indexed in this browser in ${Math.round(performance.now() - t0)} ms. Searching sends nothing anywhere.`
        mount.dataset.ready = 'full'
        draw()
    } catch (e) {
        status.textContent = `The index did not load: ${String(e && e.message || e)}.`
    }
}
