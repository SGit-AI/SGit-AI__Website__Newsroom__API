/**
 * graphs.js: the graphs a wire's vault already holds, drawn as SVG from data/bundle.json.
 *
 * The desk's brief (docs/GRAPHS.md in every vault) says the data is already a graph: each story is sources on the
 * left, the story in the centre and the entities it names on the right; the deliveries file is story × persona; the
 * threads are stories on a date axis; and the week falls out of the dates, the beats and the entities two stories
 * share. This module draws those, and nothing else: pure functions, data in, one element out.
 *
 * The rules, the same as wire.js: everything from a vault is text. Elements are made with createElementNS and
 * createElement, every label is a text node, and a value from the vault is only ever the text of a node or the value
 * of an attribute this file names (aria-label, a title). Nothing from the vault becomes a tag, an attribute name, an
 * id or a class; the ids and classes here are fixed strings. A link is made only from an http(s) value. No innerHTML.
 *
 * Every colour is a token from assets/themes/themes.css, written as var(--token) in the SVG's own fill and stroke
 * attributes, so the five themes reach the graphs without this file knowing them. The sizes are in wire.css (.graph).
 *
 * A function never throws on a missing or malformed field: an absent list is empty, an absent string is blank, a date
 * that is not YYYY-MM-DD is undated. Each export is wrapped so that a fault in the drawing is a line of text on the
 * page and a warning in the console, not a broken edition.
 *
 * @module graphs
 */
const SVG = 'http://www.w3.org/2000/svg'

// the licence tiers, as the sources page colours them: A an open licence (the accent's tint), B quote and link (warn),
// C link only (the second panel); no tier is the panel with a faint line
const TIER = { A: ['var(--tint-solid)', 'var(--accent)'], B: ['var(--warn-bg)', 'var(--warn-ink)'], C: ['var(--panel2)', 'var(--dim2)'] }
const NO_TIER = ['var(--panel)', 'var(--line2)']
// one colour per series (a beat), in a fixed order, all tokens; an eighth beat starts again with a lighter weight
const SERIES = ['var(--accent)', 'var(--warm)', 'var(--info-ink)', 'var(--danger-ink)', 'var(--yellow)', 'var(--dim2)', 'var(--accent-dk)', 'var(--warn-ink)']
const ENTITY_KINDS = [['cves', 'cve', 3], ['orgs', 'org', 4], ['products', 'product', 3], ['people', 'person', 2], ['tech', 'tech', 2], ['events', 'event', 2], ['standards', 'standard', 2]]

// ---------------------------------------------------------------- helpers: elements and data
const el = (tag, attrs, ...kids) => fill(document.createElementNS(SVG, tag), attrs, kids)
const htm = (tag, attrs, ...kids) => fill(document.createElement(tag), attrs, kids)
function fill(e, attrs, kids) {
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, String(v))
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
    return e
}
const text = (x, y, s, attrs) => el('text', { x, y, ...(attrs || {}) }, s)
const arr = x => Array.isArray(x) ? x : []
const obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {}
const str = (x, n) => { const t = x == null || typeof x === 'object' ? '' : String(x); return n && t.length > n ? t.slice(0, n - 1).replace(/\s+$/, '') + '…' : t }
const own = (o, k) => Object.prototype.hasOwnProperty.call(obj(o), k) ? o[k] : undefined
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))
const isHttp = u => /^https?:\/\/[^\s"'<>]+$/.test(String(u || ''))
const tier = t => (t === 'A' || t === 'B' || t === 'C') ? t : ''
const hostOf = u => { try { return new URL(String(u)).host.replace(/^www\./, '') } catch (e) { return '' } }
const sameUrl = (a, b) => isHttp(a) && isHttp(b) && String(a).replace(/\/$/, '') === String(b).replace(/\/$/, '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`
const dayMs = 864e5
const dayOf = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const dateOf = ms => new Date(ms).toISOString().slice(0, 10)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = d => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1] || ''}`
const wrap = (s, n) => { const out = []; let line = ''; for (const w of str(s).split(/\s+/).filter(Boolean)) { if (line && (line + ' ' + w).length > n) { out.push(line); line = w } else line = line ? line + ' ' + w : w } if (line) out.push(line); return out }
const ids = stories => arr(stories).map((s, i) => { const id = str(own(s, 'id')); return id || `story-${i + 1}` })

/** A figure that wraps an svg (or a line of text when there is nothing to draw), with the title as its caption. */
const figure = (cls, title, body, caption) => htm('figure', { class: `graph ${cls}` }, body, htm('figcaption', {}, caption || title))
const svgRoot = (cls, w, h, label) => { const s = el('svg', { class: cls, viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', 'aria-label': label }); s.append(el('title', {}, label)); return s }
const arrowDefs = () => el('defs', {}, el('marker', { id: 'pv-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--dim2)' })))

/** A drawing that fails is a sentence on the page, never a thrown error in the edition. */
const safe = (name, fn) => function (...args) {
    try { return fn(...args) } catch (e) {
        try { console.warn(`graphs.${name}:`, e) } catch (e2) { /* nothing to say it to */ }
        return htm('p', { class: 'graph-err dim' }, `The ${name} graph could not be drawn.`)
    }
}

/** The sources of a story in drawing order: the primary first (always one row, even when the vault left it out), then the coverage. */
export function sourcesOf(story) {
    const s = obj(story), p = obj(s.primary)
    const row = (o, primary) => ({ primary, publisher: str(o.publisher, 60) || hostOf(o.url) || (primary ? 'primary not given' : 'unnamed outlet'), title: str(o.title, 160), url: isHttp(o.url) ? String(o.url) : '', date: isDate(o.date) ? o.date : '',
                                   tier: tier(o.tier), fetched: primary ? s.primary_fetched !== false : true, quoted: sameUrl(s.quote_source_url, o.url) })
    return [row(p, true), ...arr(s.coverage).filter(c => c && typeof c === 'object').slice(0, 12).map(c => row(c, false))]   // a coverage entry that is not an object is not an outlet
}

/** The entities a story names, flattened: [{ name, kind }] in the brief's order, CVEs first, capped per kind and in all. */
export function entitiesOf(story, cap = 9) {
    const e = obj(obj(story).entities), out = [], seen = new Set()
    // an entity is a name; a number or an object in the list is not one
    for (const [key, kind, n] of ENTITY_KINDS) for (const v of arr(own(e, key)).filter(x => typeof x === 'string').slice(0, n)) { const name = str(v, 80); if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push({ name, kind }) } }
    return out.slice(0, cap)
}

// ---------------------------------------------------------------- 1a. the provenance strip
/**
 * One dot per source: the primary larger and in the accent (hollow and dashed when primary_fetched is false), each
 * coverage dot coloured by its tier, the quoted source ringed. The title says how many sources and of what kind.
 */
export const provenanceStrip = safe('provenance strip', function (story) {
    const src = sourcesOf(story), R = 5.5, r = 4, gap = 5, H = 16, cy = H / 2
    const others = src.slice(1), tiers = { A: 0, B: 0, C: 0, '': 0 }
    for (const o of others) tiers[o.tier]++
    const kinds = [tiers.A ? `${tiers.A} tier A` : '', tiers.B ? `${tiers.B} tier B` : '', tiers.C ? `${tiers.C} tier C` : '', tiers[''] ? `${tiers['']} not in the registry` : ''].filter(Boolean).join(', ')
    const quoted = src.find(x => x.quoted)
    const label = `${plural(src.length, 'source')}: the primary is ${src[0].publisher}${src[0].fetched ? '' : ', not fetched'}` + (others.length ? `; ${plural(others.length, 'other outlet')} (${kinds})` : '') + (quoted ? `; the quote is from ${quoted.publisher}` : '') + '.'
    let x = R + 1.5
    const W = R * 2 + 3 + others.length * (r * 2 + gap)
    const svg = svgRoot('pv-strip', W, H, label)
    for (const o of src) {
        const [fillC, strokeC] = o.primary ? ['var(--accent)', 'var(--accent)'] : (TIER[o.tier] || NO_TIER)
        const g = el('g', { class: o.primary ? 'p' : 'c' }, el('title', {}, `${o.primary ? 'Primary: ' : ''}${o.publisher}${o.tier ? ` · tier ${o.tier}` : o.primary ? '' : ' · not in the registry'}${o.primary && !o.fetched ? ' · not fetched' : ''}${o.quoted ? ' · quoted' : ''}`))
        g.append(el('circle', { cx: x, cy, r: o.primary ? R : r, fill: o.primary && !o.fetched ? 'none' : fillC, stroke: strokeC, 'stroke-width': 1.5, 'stroke-dasharray': o.primary && !o.fetched ? '2 1.5' : null }))
        if (o.quoted) g.append(el('circle', { cx: x, cy, r: (o.primary ? R : r) + 2.5, fill: 'none', stroke: 'var(--fg)', 'stroke-width': 1 }))
        svg.append(g)
        x += (o.primary ? R : r) * 2 + gap
    }
    return svg
})

// ---------------------------------------------------------------- 1b. the provenance graph
/**
 * Three columns, as the desk draws it in the story drawer: the sources on the left with their tier chips, the story in
 * the centre, the entities on the right; edges is_primary_for, covers and names; a dashed primary when it was not
 * fetched, the word quoted on the quoted source, CVE nodes in the danger colour. A source with an http(s) url is a link.
 */
export const provenanceGraph = safe('provenance', function (story) {
    const s = obj(story), src = sourcesOf(s), ents = entitiesOf(s)
    const rows = Math.max(src.length, ents.length, 3), H = rows * 50 + 60, W = 820, cx = 410, cy = H / 2
    const yAt = (i, n) => 40 + (H - 80) * (n === 1 ? 0.5 : i / (n - 1))
    const headline = str(s.headline) || 'untitled story'
    const label = `Provenance of “${str(headline, 120)}”: ${plural(src.length, 'source')}${src[0].fetched ? '' : ', the primary not fetched'}, ${plural(ents.length, 'entity', 'entities')} named${ents.some(e => e.kind === 'cve') ? ', including a CVE' : ''}.`
    const svg = svgRoot('pv-graph', W, H, label)
    svg.append(arrowDefs())
    // edges first, so the nodes sit on them
    src.forEach((x, i) => { const y = yAt(i, src.length)
        svg.append(el('path', { d: `M232,${y} C320,${y} 300,${cy} ${cx - 112},${cy}`, fill: 'none', stroke: x.primary ? 'var(--accent)' : 'var(--line2)', 'stroke-width': x.primary ? 2.4 : 1.4, 'stroke-dasharray': x.primary && !x.fetched ? '5 4' : null, 'marker-end': 'url(#pv-arrow)' }))
        if (i < 2) svg.append(text(242, y - 8, x.primary ? 'is_primary_for' : 'covers', { class: 'edge', 'font-size': 11, fill: 'var(--dim)' }))
    })
    ents.forEach((e, i) => { const y = yAt(i, ents.length); svg.append(el('path', { d: `M${cx + 112},${cy} C${cx + 180},${cy} 520,${y} 588,${y}`, fill: 'none', stroke: 'var(--line2)', 'stroke-width': 1.3, 'marker-end': 'url(#pv-arrow)' })) })
    if (ents.length) svg.append(text(cx + 150, cy - 10, 'names', { class: 'edge', 'font-size': 11, fill: 'var(--dim)' }))
    // the sources
    src.forEach((x, i) => { const y = yAt(i, src.length), [chipFill, chipStroke] = TIER[x.tier] || NO_TIER
        const g = el('g', { class: x.primary ? 'src primary' : 'src' }, el('title', {}, x.title || x.publisher),
            el('rect', { x: 12, y: y - 22, width: 220, height: 44, rx: 6, fill: 'var(--panel)', stroke: x.primary ? 'var(--accent)' : 'var(--line2)', 'stroke-width': x.primary ? 2 : 1, 'stroke-dasharray': x.primary && !x.fetched ? '5 4' : null }),
            el('rect', { x: 20, y: y - 9, width: 18, height: 18, rx: 4, fill: chipFill, stroke: chipStroke }),
            text(29, y + 4, x.tier || '?', { 'font-size': 11, 'font-weight': 600, 'text-anchor': 'middle', fill: x.tier ? chipStroke : 'var(--dim)' }),
            text(46, y - 3, str(x.publisher, 30), { 'font-size': 13, 'font-weight': 600, fill: 'var(--fg)' }),
            text(46, y + 13, (x.primary ? (x.fetched ? 'primary source' : 'primary · not fetched') : (x.date || 'undated')) + (x.quoted ? ' · quoted' : ''), { 'font-size': 11, fill: 'var(--dim)' }))
        svg.append(x.url ? el('a', { href: x.url, target: '_blank', rel: 'noopener' }, g) : g)
    })
    // the story
    const lines = wrap(headline, 26).slice(0, 4), boxH = lines.length * 18 + 28
    svg.append(el('rect', { x: cx - 110, y: cy - boxH / 2, width: 220, height: boxH, rx: 8, fill: 'var(--tint-solid)', stroke: 'var(--accent)', 'stroke-width': 2 }))
    lines.forEach((l, i) => svg.append(text(cx, cy - boxH / 2 + 24 + i * 18, l + (i === 3 && wrap(headline, 26).length > 4 ? '…' : ''), { class: 'serif', 'font-size': 13.5, 'font-weight': 600, 'text-anchor': 'middle', fill: 'var(--fg)' })))
    // the entities
    ents.forEach((e, i) => { const y = yAt(i, ents.length), cve = e.kind === 'cve'
        svg.append(el('g', { class: cve ? 'ent cve' : 'ent' }, el('title', {}, `${e.name} (${e.kind})`),
            el('rect', { x: 590, y: y - 15, width: 218, height: 30, rx: 15, fill: cve ? 'var(--danger-bg)' : 'var(--panel)', stroke: cve ? 'var(--danger-ink)' : 'var(--line2)' }),
            text(606, y + 4, str(e.name, 26), { 'font-size': 12.5, fill: cve ? 'var(--danger-ink)' : 'var(--fg)' }),
            text(800, y + 4, e.kind, { 'font-size': 10.5, 'text-anchor': 'end', fill: cve ? 'var(--danger-ink)' : 'var(--dim)' })))
    })
    return figure('provenance', label, svg)
})

// ---------------------------------------------------------------- 5. entity co-occurrence
/**
 * The table behind the co-occurrence graph: every entity named by `min` or more stories (case-insensitively, across the
 * entity kinds), with its count and the ids of the stories, most named first; at most `max` rows. Pure; runs in Node.
 */
export function cooccurrenceTable(stories, opts) {
    const o = obj(opts), min = Number.isFinite(o.min) && o.min > 0 ? o.min : 2, max = Number.isFinite(o.max) && o.max > 0 ? o.max : 40
    const byKey = new Map(), sid = ids(stories)
    arr(stories).forEach((s, i) => {
        const e = obj(obj(s).entities), seen = new Set()
        for (const [key, kind] of ENTITY_KINDS) for (const v of arr(own(e, key))) {
            if (typeof v !== 'string') continue
            const name = str(v, 80), k = name.toLowerCase()
            if (!name || seen.has(k)) continue
            seen.add(k)
            if (!byKey.has(k)) byKey.set(k, { entity: name, kind, count: 0, stories: [], spellings: new Map() })
            const row = byKey.get(k); row.count++; row.stories.push(sid[i]); row.spellings.set(name, (row.spellings.get(name) || 0) + 1)
        }
    })
    // the name shown is the spelling the desk used most often (OpenAI over openai), the first seen on a tie
    return [...byKey.values()].map(({ spellings, ...r }) => ({ ...r, entity: [...spellings.entries()].reduce((a, b) => b[1] > a[1] ? b : a)[0] }))
        .filter(r => r.count >= min).sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity)).slice(0, max)
}

/**
 * Entities named by two or more stories, as a bipartite drawing: entities on the left with their counts, the stories
 * they share on the right, a line for each naming. The returned figure carries the table as `figure.table`, for a list.
 */
export const cooccurrence = safe('co-occurrence', function (stories, opts) {
    const rows = cooccurrenceTable(stories, opts), sid = ids(stories), heads = new Map(arr(stories).map((s, i) => [sid[i], str(obj(s).headline, 120)]))
    const storyOrder = []
    for (const r of rows) for (const id of r.stories) if (!storyOrder.includes(id)) storyOrder.push(id)
    const label = rows.length ? `${plural(rows.length, 'entity', 'entities')} named by ${(obj(opts).min || 2)} or more stories, across ${plural(storyOrder.length, 'story', 'stories')}; the most named is ${rows[0].entity} (${rows[0].count}).` : 'No entity is named by two or more stories in this edition.'
    if (!rows.length) { const f = figure('cooccurrence empty', label, htm('p', { class: 'dim' }, label)); f.table = rows; return f }
    const rowH = 22, W = 820, H = Math.max(rows.length, storyOrder.length) * rowH + 40, lx = 300, rx = 540
    const ey = i => 30 + i * rowH + (Math.max(0, storyOrder.length - rows.length) * rowH) / 2, sy = i => 30 + i * rowH + (Math.max(0, rows.length - storyOrder.length) * rowH) / 2
    const svg = svgRoot('cooccurrence', W, H, label)
    const sIndex = new Map(storyOrder.map((id, i) => [id, i]))
    rows.forEach((r, i) => { for (const id of r.stories) svg.append(el('path', { d: `M${lx + 8},${ey(i)} C${lx + 120},${ey(i)} ${rx - 120},${sy(sIndex.get(id))} ${rx - 8},${sy(sIndex.get(id))}`, fill: 'none', stroke: 'var(--line2)', 'stroke-width': 1.2, opacity: 0.8 })) })
    rows.forEach((r, i) => svg.append(el('g', { class: r.kind === 'cve' ? 'ent cve' : 'ent' }, el('title', {}, `${r.entity} (${r.kind}): ${r.stories.join(', ')}`),
        text(lx - 36, ey(i) + 4, str(r.entity, 36), { 'font-size': 12.5, 'text-anchor': 'end', fill: r.kind === 'cve' ? 'var(--danger-ink)' : 'var(--fg)' }),
        el('rect', { x: lx - 30, y: ey(i) - 9, width: 34, height: 18, rx: 9, fill: 'var(--tint-solid)', stroke: 'var(--accent)' }),
        text(lx - 13, ey(i) + 4, r.count, { class: 'mono', 'font-size': 11, 'font-weight': 600, 'text-anchor': 'middle', fill: 'var(--accent-dk)' }),
        el('circle', { cx: lx + 8, cy: ey(i), r: 3, fill: 'var(--accent)' }))))
    storyOrder.forEach((id, i) => svg.append(el('g', { class: 'story' }, el('title', {}, heads.get(id) || id),
        el('circle', { cx: rx - 8, cy: sy(i), r: 3, fill: 'var(--dim2)' }),
        text(rx + 2, sy(i) + 4, str(id, 14), { class: 'mono', 'font-size': 11, fill: 'var(--fg)' }),
        text(rx + 110, sy(i) + 4, str(heads.get(id), 32), { 'font-size': 11, fill: 'var(--dim)' }))))
    const f = figure('cooccurrence', label, svg)
    f.table = rows
    return f
})

// ---------------------------------------------------------------- 5. threads as timelines
/** The rows behind the timeline: one per thread, its dated stories in date order, and how many had no date. Pure. */
export function threadRows(threads, storiesById) {
    const get = id => storiesById instanceof Map ? storiesById.get(id) : own(storiesById, id)
    return arr(threads).map((t, i) => { const th = obj(t), dated = [], undated = []
        for (const x of arr(th.stories)) { const id = str(typeof x === 'object' ? own(x, 'id') : x, 40); if (!id) continue; const s = obj(get(id)); if (isDate(s.date)) dated.push({ id, date: s.date, headline: str(s.headline, 120) }); else undated.push(id) }
        dated.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        return { id: str(th.id, 60) || `thread-${i + 1}`, title: str(th.title, 80) || str(th.id, 60) || `Thread ${i + 1}`, stories: dated, undated }
    })
}

/** Each thread's stories on one date axis, one row per thread, a dot per story labelled with its id, newest on the right. */
export const threadsTimeline = safe('threads', function (threads, storiesById) {
    const rows = threadRows(threads, storiesById), all = rows.flatMap(r => r.stories.map(s => s.date))
    const n = rows.reduce((a, r) => a + r.stories.length, 0), lost = rows.reduce((a, r) => a + r.undated.length, 0)
    if (!rows.length || !all.length) { const l = rows.length ? `${plural(rows.length, 'thread')}, but no story in them carries a date.` : 'No threads in this edition.'; return figure('threads empty', l, htm('p', { class: 'dim' }, l)) }
    const t0 = dayOf(all.reduce((a, b) => a < b ? a : b)) - dayMs, t1 = dayOf(all.reduce((a, b) => a > b ? a : b)) + dayMs
    const W = 820, L = 190, R = 20, rowH = 48, H = 30 + rows.length * rowH + 30, x = ms => L + (W - L - R) * (ms - t0) / (t1 - t0)
    const label = `${plural(rows.length, 'thread')} with ${plural(n, 'dated story', 'dated stories')} from ${dateOf(t0 + dayMs)} to ${dateOf(t1 - dayMs)}${lost ? `, ${lost} undated left out` : ''}.`
    const svg = svgRoot('threads', W, H, label)
    // the axis: a tick per day, the date on the first, the last and every Monday or so (at most ~10 labels)
    const days = Math.round((t1 - t0) / dayMs), every = Math.max(1, Math.ceil(days / 10))
    for (let i = 0; i <= days; i++) { const ms = t0 + i * dayMs, lab = i === 0 || i === days || i % every === 0
        svg.append(el('line', { x1: x(ms), x2: x(ms), y1: 24, y2: H - 26, stroke: 'var(--line)', 'stroke-width': lab ? 1 : 0.5 }))
        if (lab) svg.append(text(x(ms), H - 10, shortDate(dateOf(ms)), { 'font-size': 10.5, 'text-anchor': 'middle', fill: 'var(--dim)' }))
    }
    rows.forEach((r, i) => { const y = 30 + i * rowH + rowH / 2
        svg.append(el('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: 'var(--line2)', 'stroke-width': 1 }))
        svg.append(text(L - 10, y + 4, str(r.title, 28), { 'font-size': 12.5, 'font-weight': 600, 'text-anchor': 'end', fill: 'var(--fg)' }))
        if (r.undated.length) svg.append(text(L - 10, y + 18, `${r.undated.length} undated`, { 'font-size': 10, 'text-anchor': 'end', fill: 'var(--dim)' }))
        // stories on the same day stack upward so none is hidden; labels alternate above and below
        const onDay = new Map()
        r.stories.forEach((s, j) => { const k = onDay.get(s.date) || 0; onDay.set(s.date, k + 1); const cx = x(dayOf(s.date)), cy = y - k * 9
            svg.append(el('g', { class: 'story' }, el('title', {}, `${s.id} · ${s.date}${s.headline ? ` · ${s.headline}` : ''}`),
                el('circle', { cx, cy, r: 5, fill: SERIES[i % SERIES.length], stroke: 'var(--panel)', 'stroke-width': 1.5 }),
                text(cx, j % 2 ? cy + 17 : cy - 10, str(s.id, 12), { class: 'mono', 'font-size': 10, 'text-anchor': 'middle', fill: 'var(--fg)' })))
        })
    })
    return figure('threads', label, svg)
})

// ---------------------------------------------------------------- 5. stories by day
/**
 * The table behind the column chart: one row per day of the window (the `days` days ending on `end`, else on the latest
 * dated story), each with its total and its count per beat; and the beats in order of their totals. Pure.
 */
export function storiesByDayTable(stories, opts) {
    const o = obj(opts), days = Number.isFinite(o.days) && o.days > 0 ? Math.min(Math.floor(o.days), 366) : 14
    const dated = arr(stories).map(s => obj(s)).filter(s => isDate(s.date))
    const end = isDate(o.end) ? o.end : dated.length ? dated.map(s => s.date).reduce((a, b) => a > b ? a : b) : dateOf(Date.now())
    const endMs = dayOf(end), startMs = endMs - (days - 1) * dayMs
    const rows = [], totals = new Map()
    for (let ms = startMs; ms <= endMs; ms += dayMs) rows.push({ date: dateOf(ms), total: 0, byBeat: Object.create(null) })   // null prototype: a beat called __proto__ is a key, not the prototype
    const at = new Map(rows.map(r => [r.date, r]))
    for (const s of dated) { const r = at.get(s.date); if (!r) continue; const beat = str(s.beat, 60) || 'unassigned'
        r.total++; r.byBeat[beat] = (own(r.byBeat, beat) || 0) + 1; totals.set(beat, (totals.get(beat) || 0) + 1) }
    const beats = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, total]) => ({ id, total }))
    return { start: dateOf(startMs), end, days: rows, beats, total: rows.reduce((a, r) => a + r.total, 0), undated: arr(stories).length - dated.length }
}

/** A column chart of stories per day, stacked by beat, with a legend under it; `opts.beats` gives the labels. */
export const storiesByDay = safe('stories by day', function (stories, opts) {
    const o = obj(opts), t = storiesByDayTable(stories, o), labelOf = new Map(arr(o.beats).map(b => [str(obj(b).id, 60), str(obj(b).label, 60)]))
    const name = id => labelOf.get(id) || id
    const label = `${plural(t.total, 'story', 'stories')} dated ${t.start} to ${t.end}, by day and beat${t.beats.length ? `; most in ${name(t.beats[0].id)} (${t.beats[0].total})` : ''}${t.undated ? `; ${t.undated} undated left out` : ''}.`
    const W = 820, H = 230, L = 36, R = 10, T = 16, B = 34, n = t.days.length, gap = 4, colW = (W - L - R) / n - gap
    const max = Math.max(1, ...t.days.map(d => d.total)), y = v => T + (H - T - B) * (1 - v / max)
    const svg = svgRoot('by-day', W, H, label)
    // the y axis: a line at every whole count up to max, labelled at a few
    const step = max > 12 ? Math.ceil(max / 6) : max > 6 ? 2 : 1
    for (let v = 0; v <= max; v += step) { svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': v ? 0.6 : 1 })); svg.append(text(L - 6, y(v) + 4, v, { 'font-size': 10.5, 'text-anchor': 'end', fill: 'var(--dim)' })) }
    const idx = new Map(t.beats.map((b, i) => [b.id, i]))
    t.days.forEach((d, i) => { const x0 = L + i * (colW + gap) + gap / 2
        let acc = 0
        const g = el('g', { class: 'day' }, el('title', {}, `${d.date}: ${plural(d.total, 'story', 'stories')}${d.total ? ' (' + t.beats.filter(b => own(d.byBeat, b.id)).map(b => `${name(b.id)} ${d.byBeat[b.id]}`).join(', ') + ')' : ''}`))
        for (const b of t.beats) { const v = own(d.byBeat, b.id) || 0; if (!v) continue
            g.append(el('rect', { x: x0, y: y(acc + v), width: colW, height: y(acc) - y(acc + v), fill: SERIES[idx.get(b.id) % SERIES.length], opacity: idx.get(b.id) >= SERIES.length ? 0.55 : 1 })); acc += v }
        if (d.total) g.append(text(x0 + colW / 2, y(d.total) - 4, d.total, { class: 'mono', 'font-size': 10, 'text-anchor': 'middle', fill: 'var(--fg)' }))
        g.append(text(x0 + colW / 2, H - B + 14, n > 21 ? (i % 7 === 0 || i === n - 1 ? shortDate(d.date) : '') : shortDate(d.date), { 'font-size': 10.5, 'text-anchor': 'middle', fill: 'var(--dim)' }))
        svg.append(g)
    })
    const legend = htm('ul', { class: 'legend', 'aria-label': 'Beats' }, t.beats.map((b, i) => htm('li', {}, htm('span', { class: 'sw', style: `background:${SERIES[i % SERIES.length]};opacity:${i >= SERIES.length ? 0.55 : 1}` }), `${name(b.id)} (${b.total})`)))
    return figure('by-day', label, [svg, legend])
})

// ---------------------------------------------------------------- the sources' tally
/** The table behind the tally: one row per source that gave a primary (primary.source, else its publisher), with its tier. Pure. */
export function sourcesTallyTable(stories, sources, opts) {
    const o = obj(opts), max = Number.isFinite(o.max) && o.max > 0 ? o.max : 30
    const reg = new Map()
    for (const s of arr(sources)) { const x = obj(s); const id = str(x.id, 80), name = str(x.name, 120); if (id) reg.set(id, { name: name || id, tier: tier(x.tier) }); if (name && !reg.has(name)) reg.set(name, { name, tier: tier(x.tier) }) }
    const rows = new Map()
    for (const s of arr(stories)) { const p = obj(obj(s).primary), key = str(p.source, 80) || str(p.publisher, 120); if (!key) continue
        if (!rows.has(key)) { const r = reg.get(key); rows.set(key, { key, name: r ? r.name : key, tier: (r && r.tier) || tier(p.tier), count: 0, registered: !!r }) }
        rows.get(key).count++ }
    const all = [...rows.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return { rows: all.slice(0, max), sources: all.length, stories: all.reduce((a, r) => a + r.count, 0), without: arr(stories).filter(s => { const p = obj(obj(s).primary); return !str(p.source) && !str(p.publisher) }).length }
}

/** A horizontal bar per source of how many stories it gave as the primary, tier-coloured, most first. */
export const sourcesTally = safe('sources', function (stories, sources, opts) {
    const t = sourcesTallyTable(stories, sources, opts)
    const label = t.rows.length ? `${plural(t.sources, 'source')} gave ${plural(t.stories, 'primary', 'primaries')}; the most from ${t.rows[0].name} (${t.rows[0].count})${t.sources > t.rows.length ? `; the top ${t.rows.length} shown` : ''}${t.without ? `; ${t.without} stories name no source` : ''}.` : 'No story names a primary source.'
    if (!t.rows.length) return figure('tally empty', label, htm('p', { class: 'dim' }, label))
    const W = 820, L = 300, R = 50, rowH = 20, H = t.rows.length * rowH + 16, max = Math.max(1, ...t.rows.map(r => r.count))
    const svg = svgRoot('tally', W, H, label)
    t.rows.forEach((r, i) => { const y = 8 + i * rowH, [fillC, strokeC] = TIER[r.tier] || NO_TIER, w = Math.max(2, (W - L - R) * r.count / max)
        svg.append(el('g', { class: 'bar' }, el('title', {}, `${r.name}: ${plural(r.count, 'story', 'stories')}${r.tier ? `, tier ${r.tier}` : ', no tier'}${r.registered ? '' : ', not in the registry'}`),
            text(L - 8, y + 14, str(r.name, 44), { 'font-size': 11.5, 'text-anchor': 'end', fill: 'var(--fg)' }),
            el('rect', { x: L, y: y + 3, width: w, height: rowH - 6, rx: 3, fill: fillC, stroke: strokeC }),
            text(L + w + 6, y + 14, `${r.count}${r.tier ? ` · ${r.tier}` : ''}`, { class: 'mono', 'font-size': 10.5, fill: 'var(--dim)' })))
    })
    return figure('tally', label, svg)
})

// ---------------------------------------------------------------- 4. the persona join as a matrix
/** The table behind the heatmap: a row per story with one cell per persona (reached, withheld, or none recorded). Pure. */
export function deliveriesTable(stories, personas, deliveries, opts) {
    const o = obj(opts), max = Number.isFinite(o.max) && o.max > 0 ? o.max : 120
    const cols = arr(personas).map(p => obj(p)).map(p => ({ id: str(p.id, 60), name: str(p.name, 40) || str(p.id, 60) })).filter(p => p.id)
    const sid = ids(stories), status = new Map()
    for (const d of arr(deliveries)) { const x = obj(d), k = `${str(x.story, 60)}\n${str(x.persona, 60)}`; status.set(k, x.status === 'reached' ? 'reached' : x.status === 'withheld' ? 'withheld' : 'other') }
    let reached = 0, withheld = 0
    const rows = arr(stories).slice(0, max).map((s, i) => ({ id: sid[i], headline: str(obj(s).headline, 120), cells: cols.map(c => { const st = status.get(`${sid[i]}\n${c.id}`) || 'none'; if (st === 'reached') reached++; if (st === 'withheld') withheld++; return st }) }))
    return { cols, rows, reached, withheld, stories: arr(stories).length }
}

/** A small heatmap of story × persona: a filled cell where the join reached the persona, an empty one where it withheld, nothing where no row was recorded. */
export const deliveriesMatrix = safe('deliveries', function (stories, personas, deliveries, opts) {
    const t = deliveriesTable(stories, personas, deliveries, opts)
    const label = t.rows.length && t.cols.length ? `${plural(t.rows.length, 'story', 'stories')} × ${plural(t.cols.length, 'persona')}: ${t.reached} reached, ${t.withheld} withheld${t.stories > t.rows.length ? `; the first ${t.rows.length} stories shown` : ''}.` : 'No stories or no personas to join.'
    if (!t.rows.length || !t.cols.length) return figure('deliveries empty', label, htm('p', { class: 'dim' }, label))
    const cell = 14, L = 90, T = 70, W = L + t.cols.length * cell + 10, H = T + t.rows.length * cell + 6
    const svg = svgRoot('deliveries', W, H, label)
    t.cols.forEach((c, j) => svg.append(text(L + j * cell + cell / 2 + 3, T - 6, str(c.name, 18), { 'font-size': 10.5, fill: 'var(--fg)', transform: `rotate(-60 ${L + j * cell + cell / 2 + 3} ${T - 6})` })))
    t.rows.forEach((r, i) => { const y = T + i * cell
        const g = el('g', { class: 'row' }, el('title', {}, r.headline || r.id), text(L - 6, y + cell - 3, str(r.id, 12), { class: 'mono', 'font-size': 9.5, 'text-anchor': 'end', fill: 'var(--fg)' }))
        r.cells.forEach((st, j) => { if (st === 'none') return
            g.append(el('rect', { x: L + j * cell + 1, y: y + 1, width: cell - 2, height: cell - 2, rx: 2, fill: st === 'reached' ? 'var(--accent)' : st === 'withheld' ? 'var(--panel)' : 'var(--warn-bg)', stroke: st === 'reached' ? 'var(--accent-dk)' : 'var(--line2)', 'stroke-width': 0.8 })) })
        svg.append(g)
    })
    const legend = htm('ul', { class: 'legend' }, htm('li', {}, htm('span', { class: 'sw', style: 'background:var(--accent)' }), 'reached'), htm('li', {}, htm('span', { class: 'sw', style: 'border:1px solid var(--line2)' }), 'withheld'))
    return figure('deliveries', label, [svg, legend])
})
