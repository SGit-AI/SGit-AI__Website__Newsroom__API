/**
 * reading-list.js: a reading list in a link. Parse it, build it, show it, and open it as a persona.
 *
 *   https://newsroom.sgit.ai/for/#from=Dinis&to=Steve&r=61,44,70&s=52&f=founder&n=…&e=…
 *
 *   from, to   two first names, shown as "For Steve, from Dinis"
 *   r          articles to read, by number, in this order
 *   s          articles worth a look
 *   f          what to follow: a persona id (founder) or a collection (c:how-agents-decide)
 *   n          one sentence from the sender
 *   e          the sender's address, which turns on a Reply button; without it there is none
 *
 * Everything is in the fragment, the part after the #, which a browser keeps to itself. The numbers are
 * the contract (articles/ids.json, admin/build/ids.py); the names and the note are display text, and
 * nothing in a link should be private, because the link travels in an email.
 *
 * parse() and build() are plain functions with no page in them, so admin/build/test_lists.mjs runs them
 * under node. Everything that touches the page is below them, and writes data from the link with
 * textContent and never as HTML.
 *
 * @module reading-list
 */

export const LIMITS = Object.freeze({ name: 40, note: 240, email: 80, list: 50, follow: 10 })

const FIELDS  = ['from', 'to', 'r', 's', 'f', 'n', 'e']
const NAME    = /^[\p{L}][\p{L}\p{M} '’-]*$/u
const EMAIL   = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,60}[A-Za-z0-9])?\.[A-Za-z]{2,24}$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

/** A piece of a link, shortened and stripped of control characters, for saying what was left out. */
const shown = (s, n = 24) => { const t = String(s).replace(CONTROL, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }

// ------------------------------------------------------------ the fields
export function cleanName(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
    if (!s) return { value: '', ok: true, empty: true }
    if (s.length > LIMITS.name) return { value: '', ok: false, why: `longer than ${LIMITS.name} characters` }
    if (!NAME.test(s)) return { value: '', ok: false, why: 'letters, spaces, hyphens and apostrophes only' }
    return { value: s, ok: true }
}

export function cleanNote(v) {
    const s = String(v == null ? '' : v).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
    if (!s) return { value: '', ok: true, empty: true }
    if (s.length > LIMITS.note) return { value: '', ok: false, why: `longer than ${LIMITS.note} characters` }
    return { value: s, ok: true }
}

export function cleanEmail(v) {
    const s = String(v == null ? '' : v).trim()
    if (!s) return { value: '', ok: true, empty: true }
    if (s.length > LIMITS.email || !EMAIL.test(s)) return { value: '', ok: false, why: 'not an email address' }
    return { value: s, ok: true }
}

// ------------------------------------------------------------ the context a link is read against
/**
 * What a link is checked against: the numbered articles (articles/ids.json), the personas that can be
 * followed (the meter's presets) and the collections.
 */
export function contextFrom(idsDoc, presets) {
    return {
        byNumber    : new Map((idsDoc.articles || []).map(e => [e.n, e])),
        personas    : (presets || []).map(p => ({ id: p.id, name: p.name, label: p.label, blurb: p.blurb, theme: p.theme })),
        collections : idsDoc.collections || [],
        topics      : idsDoc.topics || [],
    }
}

// ------------------------------------------------------------ parse
/**
 * Read the part of a link after the #. Everything is validated, and anything malformed is dropped and
 * listed in `ignored`, so the page can say what it left out and the sender can fix it.
 *
 * Returns { from, to, note, email, read:[entry], look:[entry], follow:[{kind,…}], ignored:[text], given }.
 * `given` is whether the link named any field this page reads; without it the page explains itself.
 */
export function parse(hash, ctx) {
    const out = { from: '', to: '', note: '', email: '', read: [], look: [], follow: [], ignored: [], given: false }
    const raw = String(hash || '').replace(/^#/, '')
    if (!raw) return out
    const params = new URLSearchParams(raw)
    out.given = FIELDS.some(k => params.has(k))
    const unknown = new Set()
    for (const k of params.keys()) if (!FIELDS.includes(k) && !unknown.has(k)) {
        unknown.add(k)
        out.ignored.push(`“${shown(k)}”, which is not a field this page reads`)
    }
    const field = (k, label, clean) => {
        if (!params.has(k)) return ''
        const c = clean(params.get(k))
        if (!c.ok) { out.ignored.push(`the ${label} (${c.why})`); return '' }
        return c.value
    }
    out.from  = field('from', 'sender’s name', cleanName)
    out.to    = field('to', 'recipient’s name', cleanName)
    out.note  = field('n', 'note', cleanNote)
    out.email = field('e', 'reply address', cleanEmail)

    const taken = new Set()
    const articles = (k, group) => {
        if (!params.has(k)) return
        for (const tok of params.get(k).split(',').map(t => t.trim()).filter(Boolean)) {
            if (!/^\d{1,4}$/.test(tok)) { out.ignored.push(`“${shown(tok, 12)}”, which is not an article number`); continue }
            const n = Number(tok)
            const e = ctx.byNumber.get(n)
            if (!e) { out.ignored.push(`article ${n}, which does not exist`); continue }
            if (taken.has(n)) { out.ignored.push(`article ${n}, which is already in the list`); continue }
            if (taken.size >= LIMITS.list) { out.ignored.push(`article ${n}, because a list holds at most ${LIMITS.list}`); continue }
            taken.add(n)
            group.push(e)
        }
    }
    articles('r', out.read)
    articles('s', out.look)

    if (params.has('f')) {
        for (const tok of params.get('f').split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) {
            if (out.follow.length >= LIMITS.follow) { out.ignored.push(`“${shown(tok, 24)}” and anything after it, because a list follows at most ${LIMITS.follow}`); break }
            if (tok.startsWith('c:')) {
                const c = ctx.collections.find(x => x.slug === tok.slice(2))
                if (!c) out.ignored.push(`“${shown(tok, 40)}”, which is not a collection here`)
                else if (!out.follow.some(f => f.kind === 'collection' && f.slug === c.slug)) out.follow.push({ kind: 'collection', slug: c.slug, title: c.title })
            } else {
                const p = ctx.personas.find(x => x.id === tok)
                if (!p) out.ignored.push(`“${shown(tok, 40)}”, which is not a persona here`)
                else if (!out.follow.some(f => f.kind === 'persona' && f.id === p.id)) out.follow.push({ kind: 'persona', ...p })
            }
        }
    }
    return out
}

// ------------------------------------------------------------ build
export const followToken = f => f.kind === 'collection' ? `c:${f.slug}` : f.id

/**
 * The link for a list: spec is { from, to, read:[n], look:[n], follow:[token], note, email }, each part
 * optional. Names and the note are percent-encoded; numbers and tokens contain nothing that needs it.
 */
export function build(base, spec) {
    const parts = []
    const add = (k, v, raw) => { if (v) parts.push(`${k}=${raw ? v : encodeURIComponent(v)}`) }
    add('from', spec.from)
    add('to', spec.to)
    add('r', (spec.read || []).join(','), true)
    add('s', (spec.look || []).join(','), true)
    add('f', (spec.follow || []).join(','), true)
    add('n', spec.note)
    add('e', spec.email)
    return base + '#' + parts.join('&')
}

/** The spec of a parsed list: what build() takes, so a link can be opened for editing. */
export const specOf = p => ({
    from: p.from, to: p.to, note: p.note, email: p.email,
    read: p.read.map(e => e.n), look: p.look.map(e => e.n), follow: p.follow.map(followToken),
})

// ------------------------------------------------------------ names
export function titleFor(p) {
    if (p.to && p.from) return `For ${p.to}, from ${p.from}`
    if (p.to) return `For ${p.to}`
    if (p.from) return `From ${p.from}`
    return 'A reading list'
}

/** The persona a list becomes: "Steve's list, from Dinis". */
export function personaName(p) {
    if (p.to && p.from) return `${p.to}'s list, from ${p.from}`
    if (p.to) return `${p.to}'s list`
    if (p.from) return `A list from ${p.from}`
    return 'A reading list'
}

/** The same list always has the same key, so opening a link twice does not add a persona twice. */
export function listKey(p) {
    const s = [p.from, p.to, p.read.map(e => e.n).join(','), p.look.map(e => e.n).join(',')].join('|')
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return 'list-' + h.toString(36)
}

// ------------------------------------------------------------ the page
/** Build an element: h('a', { href }, 'text', child). Strings become text nodes, never HTML. */
export function h(tag, attrs, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v == null) continue
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
        else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}

const when = d => { try { return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) } catch (e) { return d } }

/** A mailto link for the sender's own address, built from an address that has passed cleanEmail(). */
export function replyLink(p) {
    if (!p.email) return null
    const subject = encodeURIComponent(p.to ? `${p.to}’s reading list` : 'Your reading list')
    return h('a', { class: 'rl-btn', href: `mailto:${p.email}?subject=${subject}` }, p.from ? `Reply to ${p.from}` : 'Reply')
}

/**
 * The list as the recipient sees it. o: { root, price(entry) → pence, money(pence) → text, afterHeader: node,
 * preview: boolean }. Nothing in p is trusted as markup.
 */
export function renderList(p, o = {}) {
    const root  = o.root || ''
    const price = o.price || (() => 0)
    const money = o.money || (n => `${n}p`)
    const href  = e => `${root}articles/${e.slug}.html`
    const item = e => e.withdrawn
        ? h('li', { class: 'rl-item gone' }, h('span', { class: 'rl-n' }, `No. ${e.n}`),
            h('div', {}, h('b', {}, 'No longer published'), h('p', { class: 'rl-teaser' }, `This list names article ${e.n}, which has been withdrawn.`)))
        : h('li', { class: 'rl-item' }, h('span', { class: 'rl-n' }, `No. ${e.n}`),
            h('div', {},
                h('a', { class: 'rl-t', href: href(e) }, e.title),
                h('p', { class: 'rl-teaser' }, e.teaser || ''),
                h('p', { class: 'rl-meta' }, [when(e.date), e.minutes ? `${e.minutes} min` : null, `${money(price(e))} to read to the end`].filter(Boolean).join(' · '))))
    const group = (label, list, ordered) => list.length ? [h('h3', { class: 'rl-h' }, label), h(ordered ? 'ol' : 'ul', { class: 'rl-items' }, list.map(item))] : []
    const live = [...p.read, ...p.look].filter(e => !e.withdrawn)
    const first = (p.read.find(e => !e.withdrawn) || p.look.find(e => !e.withdrawn))
    const total = live.reduce((n, e) => n + price(e), 0)
    const reply = replyLink(p)
    const followers = p.follow.map(f => f.kind === 'persona'
        ? h('a', { class: 'rl-follow', href: `${root}persona/${f.id}/`, style: f.theme ? `--pc:${f.theme}` : null },
            h('b', {}, `Read as ${f.name}, ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}`), h('span', {}, f.blurb || ''))
        : h('a', { class: 'rl-follow', href: `${root}articles/collections/${f.slug}.html` },
            h('b', {}, `The collection: ${f.title}`), h('span', {}, 'Articles gathered on one question.')))
    return h('section', { class: 'rl', 'aria-label': titleFor(p) },
        h('header', { class: 'rl-head' },
            h(o.level === 1 ? 'h1' : 'h2', { class: 'rl-title' }, titleFor(p)),
            p.note ? h('blockquote', { class: 'rl-note' }, p.note) : null,
            h('p', { class: 'rl-actions' },
                first ? h('a', { class: 'rl-btn primary', href: href(first) }, 'Start reading') : null, reply)),
        o.afterHeader || null,
        group('To read, in this order', p.read, true),
        group('Worth a look', p.look, false),
        followers.length ? [h('h3', { class: 'rl-h' }, 'To follow'), h('div', { class: 'rl-follows' }, followers)] : null,
        p.ignored.length ? h('p', { class: 'rl-ignored' }, h('b', {}, 'Left out of this list: '), p.ignored.join('; '), '.') : null,
        h('p', { class: 'rl-foot' },
            live.length ? `Read to the end at the newsroom’s prices, these ${live.length} article${live.length === 1 ? ' costs' : 's cost'} about ${money(total)}, from your own credit. ` : '',
            'The names and the note are whatever the link says. Nothing about this list has been sent anywhere.'))
}

// ------------------------------------------------------------ a list becomes a persona
/**
 * Open a list as a persona of the reader's, as a visitor, and make it the active one. It takes the public
 * calls of the reading meter (addPersona, renamePersona, curate) and marks the persona with the key of the
 * list, so a second visit finds it and does not add another. Never charges, never touches the reader's reading.
 */
export function visitList(meter, p) {
    const key = listKey(p)
    const have = meter.state.personas.find(x => x.list === key)
    if (have) { meter.setActive(have.id); return have }
    meter.addPersona('')
    const persona = meter.state.personas[meter.state.personas.length - 1]
    persona.list = key
    persona.visitor = true
    meter.renamePersona(persona.id, personaName(p))
    // curate() puts an article at the front, so the last in the list goes first and the sender's order is kept
    for (const e of [...p.read, ...p.look].filter(x => !x.withdrawn).reverse()) meter.curate(e.slug, 'on', persona.id)
    return persona
}

/**
 * The /for/ page. opts: { core: url of sg-meter-core.js, ids: url of articles/ids.json, root: path to the site root,
 * mount: element }. Reads the fragment, shows the list, opens it as a persona, and listens for the fragment changing.
 */
export async function openList(opts) {
    const mount = opts.mount
    let core, idsDoc
    try {
        ;[core, idsDoc] = await Promise.all([import(opts.core), fetch(opts.ids).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })])
    } catch (e) {
        mount.replaceChildren(h('p', { class: 'warn' }, 'The list of articles could not be loaded, so this list cannot be shown. Try again in a moment.'))
        return
    }
    const meter = core.meter
    const ctx = contextFrom(idsDoc, meter.cfg.personas.presets)
    const price = e => meter.priceOf({ kind: 'article', date: e.date })
    const money = n => n >= 100 ? meter.money(n) : n === 0 ? '0p' : meter.pence(n)
    let state = null           // the persona this link made, and what the reader has done with it
    // For a recipient the list is the page: its own heading replaces the page's, and the notes on how a link is made step aside.
    const pageHead = [...document.querySelectorAll('main.doc > p.eyebrow, main.doc > h1, main.doc > p.lead')]
    const docs = document.getElementById('rl-docs')
    const listOnly = on => { for (const el of pageHead) el.hidden = on; if (docs) docs.hidden = on }

    const show = () => {
        const p = parse(location.hash, ctx)
        listOnly(false)
        if (!p.given) { state = null; document.title = 'A reading list · newsroom.sgit.ai'; mount.replaceChildren(explainer(ctx, opts.root)); return }
        document.title = `${titleFor(p)} · newsroom.sgit.ai`
        if (!p.read.length && !p.look.length) {
            mount.replaceChildren(h('div', { class: 'rl-empty' },
                h('h2', {}, 'There is nothing in this list to show'),
                h('p', {}, 'The link names no article this page can open.'),
                p.ignored.length ? h('p', { class: 'rl-ignored' }, h('b', {}, 'Left out: '), p.ignored.join('; '), '.') : null,
                h('p', {}, h('a', { href: `${opts.root}for/make.html` }, 'Make a reading list'))))
            return
        }
        listOnly(true)
        const key = listKey(p)
        if (!state || state.key !== key) state = { key, mode: 'visiting', id: visitList(meter, p).id }
        const bar = h('div', { class: 'rl-persona', role: 'group', 'aria-label': 'This list as a persona' })
        const paintBar = () => {
            if (state.mode === 'visiting') bar.replaceChildren(
                h('p', {}, `This list is now one of your personas in this browser, named “${personaName(p)}”, and the picks beside it follow what is on it. Keep it, or remove it; your own reading is not changed.`),
                h('p', { class: 'rl-actions' },
                    h('button', { type: 'button', class: 'rl-btn', onclick: () => { meter.keepPersona(state.id); state.mode = 'kept'; paintBar() } }, 'Keep this list as a persona'),
                    h('button', { type: 'button', class: 'rl-btn', onclick: () => { meter.removePersona(state.id); state.mode = 'removed'; paintBar() } }, 'Remove it')))
            else if (state.mode === 'kept') bar.replaceChildren(
                h('p', {}, `Kept. “${personaName(p)}” is one of your personas now.`),
                h('p', { class: 'rl-actions' },
                    h('a', { class: 'rl-btn', href: `${opts.root}account/newsroom.html` }, 'Your newsroom, as this persona'),
                    h('a', { class: 'rl-btn', href: `${opts.root}account/personas.html` }, 'Your personas')))
            else bar.replaceChildren(
                h('p', {}, 'Removed from your personas. The list stays on this page while you are here.'),
                h('p', { class: 'rl-actions' },
                    h('button', { type: 'button', class: 'rl-btn', onclick: () => { state = { key, mode: 'visiting', id: visitList(meter, p).id }; paintBar() } }, 'Add it again')))
        }
        paintBar()
        mount.replaceChildren(renderList(p, { root: opts.root, price, money, afterHeader: bar, level: 1 }))
    }
    show()
    window.addEventListener('hashchange', show)
}

/** What a reading list is, with an example, for a visitor who arrives with no list in the link. */
function explainer(ctx, root) {
    const founder = ctx.personas.find(p => p.id === 'founder')
    const seeds = founder ? [...ctx.byNumber.values()].filter(e => (e.personas || []).includes('founder')).slice(0, 4) : []
    const example = seeds.length ? build('', { from: 'Dinis', to: 'Steve', read: seeds.slice(0, 3).map(e => e.n), look: seeds.slice(3).map(e => e.n), follow: ['founder'], note: 'Start with the first one.' }) : null
    return h('div', { class: 'rl-explain' },
        h('p', { class: 'lead' }, 'A reading list is a link from one person to another: here are the articles I think you should read, a few worth a look, and what to follow.'),
        h('p', {}, 'It is made by choosing articles and typing two first names, and it arrives as a link in an email. When it opens, the newsroom shows the list for that person, and offers it as a persona they can keep or remove. Everything that makes the list is in the part of the link after the #, which a browser does not send to the server, so there is no sign-in, and the newsroom keeps no record of who sent what to whom.'),
        example ? h('p', {}, 'An example, from Dinis to Steve: ', h('a', { href: `${root}for/${example}` }, 'open the example list'), '.') : null,
        h('p', { class: 'rl-actions' }, h('a', { class: 'rl-btn primary', href: `${root}for/make.html` }, 'Make a reading list'), h('a', { class: 'rl-btn', href: `${root}articles/a-reading-list-in-a-link.html` }, 'Why it exists')))
}
