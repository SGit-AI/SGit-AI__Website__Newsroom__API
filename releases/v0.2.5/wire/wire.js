/**
 * wire.js: the wires, each read from its own vault and drawn on this site.
 *
 * The data is not on this site. It is in an encrypted sgit vault that the wire's agents write to, and this page
 * opens it in the browser with a published read key (admin/build/wire-vault*.json, one file per wire, written into
 * the page as #wire-config with the wire's slug and the path up to the site root), through wire/vault-reader.js.
 * The Industry Wire is /wire/; the other wires are /wire/<slug>/ and share this code. Besides the edition, a vault
 * may carry a map (entities with aliases, facts, leaders and standards: the OWASP projects graph) or a stack (the
 * services a reader runs, with aliases and deadlines: the AWS wire); the page draws them when they are there. A commit to the vault is on this page within ref_ttl_s, with no
 * release of the site. What the page reads, and what it relies on, is written on wire/how.html.
 *
 * Everything from the vault is drawn as text, with createElement and textContent. A link is made only from a
 * value that is an http(s) address. The docs are read as markdown and rendered by the vendored renderer, which
 * escapes; the vault's own pre-rendered HTML is not used. The vault is writable by whoever holds its write key,
 * and this page treats what it reads as data from them, not as code.
 *
 *   data-wire="edition"   the edition, read as an inbox: what is new since the last visit, for the reader and not,
 *                         the vault's release notes, filters (inbox, new, read later, follow up, done, everything),
 *                         a decision at each story; the editor's note, the desk's corrections, threads, the lead, the
 *                         stories by beat with each story's own changes, a lens; the edition as graphs (wire/graphs.js):
 *                         a provenance strip under each headline, and folded in the header the stories per day by
 *                         beat, the threads on a date axis and the entities two or more stories share
 *   data-wire="sources"   the source registry with its tiers, and how many stories each gave this edition
 *   data-wire="how"       the wire's own documents, from docs/*.md
 *   data-wire="reach"     who a wire concerns and how to reach them, by organisation route only: what the vault
 *                         carries (the map's projects, the sources' sites, data/contacts.json when the desk adds it)
 *                         and what this site found under its published contact rules (admin/build/wire-reach.json)
 *   data-wire="days"      every wire day by day: the releases published and the stories dated that day (one page,
 *                         every vault; the config carries the wires)
 *
 * @module wire
 */
import { VaultReader, markdown } from './vault-reader.js'
import * as N from '../assets/vault-pane/notes.js'
import * as W from '../assets/vault-pane/wire-state.js'
import { pending, describePending } from '../assets/vault-pane/pending.js'
import { provenanceStrip, cooccurrence, threadsTimeline, storiesByDay } from './graphs.js'

// The reader's decision at a story, one tap: a note kept in the browser (assets/vault-pane/notes.js), carried by
// the vault pane to their devices and, when they send, to the newsroom's lane. A decision takes the story out of the
// inbox; in Everything and Done a decided story folds to its headline.
const DECISIONS = ['done', 'read-later', 'follow-up', 'not-for-me', 'more-like-this', 'wrong']

const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v) }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}
const isHttp = u => /^https?:\/\/[^\s"'<>]+$/.test(String(u || ''))
const link = (text, url, cls) => isHttp(url) ? h('a', { href: url, target: '_blank', rel: 'noopener', class: cls }) : h('span', { class: cls }),
      linkText = (text, url, cls) => { const a = link(text, url, cls); a.textContent = text; return a }
const when = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : (d || 'date not given')
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, '') } catch (e) { return '' } }
const shorten = (s, n) => { s = String(s); if (s.length <= n) return s; const cut = s.slice(0, n).replace(/\s+\S*$/, ''); return (cut || s.slice(0, n)) + '…' }

// The wire's personas and this site's: the lens follows the reader's active persona when it maps.
const PRESET_TO_WIRE = { founder: 'founder', builder: 'ai-builder', security: 'security-lead', board: 'board-member', journalist: 'journalist' }
const PUBLIC_LENSES = ['founder', 'ai-builder', 'security-lead', 'board-member', 'journalist', 'risk-owner']

export async function wire(opts) {
    const mount = opts.mount, kind = mount.getAttribute('data-wire') || 'edition'
    const cfg = JSON.parse(document.getElementById('wire-config').textContent)
    const status = document.getElementById('wire-status')
    const snapshot = document.getElementById('wire-snapshot')
    const say = (t, cls) => { status.replaceChildren(h('span', { class: cls || '' }, t)); status.hidden = false }
    const fail = e => {
        say('')
        mount.replaceChildren(h('div', { class: 'wire-err' },
            h('b', {}, 'The vault could not be opened from this browser. '),
            `${String(e && e.message || e)}. `,
            'What was in the vault at the last release of this site is below, and anyone can read the vault itself with ',
            h('code', {}, cfg.clone), '.'))
        if (snapshot) snapshot.hidden = false
    }
    if (kind === 'days') {       // every wire's vault, one page
        try { await days(mount, cfg, say); document.documentElement.setAttribute('data-wire', 'ready') } catch (e) { fail(e) }
        return
    }
    let r
    try {
        say('Opening the vault…')
        r = await new VaultReader(cfg).init()
        await r.open()
    } catch (e) { return fail(e) }

    const foot = (extra) => status.replaceChildren(
        h('span', {}, 'Read from vault ', h('b', {}, cfg.vault_id), ` at ${new Date(r.refCheckedAt || Date.now()).toISOString().slice(11, 16)} UTC · commit `, h('b', { class: 'mono' }, String(r.head).replace(/^obj-cas-imm-/, '')), r.message ? `: ${shorten(r.message, 100)}` : ''),
        h('span', {}, `${r.stats.fetch} objects fetched, ${r.stats.cacheHit + r.stats.memHit} from cache · ${extra || ''}`),
        h('button', { type: 'button', class: 'btn sm', onclick: async () => { say('Checking the vault for a new commit…'); try { await r.open({ force: true }); location.reload() } catch (e) { fail(e) } } }, 'Check for a new commit'))

    try {
        if (kind === 'edition') await edition(r, mount, foot, cfg)
        else if (kind === 'sources') await sources(r, mount, foot)
        else if (kind === 'how') await how(r, mount, foot)
        else if (kind === 'reach') await reach(r, mount, foot, cfg)
        if (snapshot) snapshot.hidden = true
        document.documentElement.setAttribute('data-wire', 'ready')
    } catch (e) { fail(e) }
}

// ------------------------------------------------------------ the edition, read as an inbox
// The design: admin/notes/2026-10-13__the-wire-as-an-inbox.md. Every story drawn is recorded as seen (wire-state.js);
// a story first seen in this visit is New. A decision at a story (done, read later, follow up, not for me, more like
// this, wrong) is a note (notes.js) and takes the story out of the inbox. All of it is kept in this browser first and
// reaches the reader vault when the reader presses Update the vault, which the bar offers when something is waiting.
const FILTERS = [['inbox', 'Inbox'], ['new', 'New'], ['read-later', 'Read later'], ['follow-up', 'Follow up'], ['done', 'Done'], ['all', 'Everything']]
const FILTER_KEY = 'sgit.wire.filter'

async function edition(r, mount, foot, cfg) {
    const scope = cfg.slug || '', up = cfg.up || '../'          // the wire's scope for seen, visit and lens; the path to the site root
    const b = await r.readJson('data/bundle.json')
    const brief = b.brief || {}, byId = new Map((b.stories || []).map(s => [s.id, s]))
    // what the vault says the wire is (data/wire.json, when the vault has one), and whose personal persona it carries
    const wireMeta = b.wire || {}, personal = wireMeta.personal_persona || (b.stack && b.stack.persona) || ''
    // a wire in more than one language (wire.languages, e.g. ["en", "pt"]): the reader picks one, kept per wire in this browser;
    // a story's headline, summary and why-it-matters are drawn in it when the vault carries `<field>_<lang>`, else in the first
    // language; a quote stays in the language of its source, and says which (quote_lang)
    const langs = (Array.isArray(wireMeta.languages) ? wireMeta.languages : []).filter(l => /^[a-z]{2}$/.test(String(l)))
    const langKey = `sgit.wire.lang${scope ? ':' + scope : ''}`
    let lang = langs[0] || ''
    try { const l = localStorage.getItem(langKey); if (l && langs.includes(l)) lang = l } catch (e) { /* the first language */ }
    const tx = (o, k) => (lang && lang !== langs[0] && typeof o[`${k}_${lang}`] === 'string' && o[`${k}_${lang}`]) ? o[`${k}_${lang}`] : o[k]
    const personas = (Array.isArray(b.personas) ? b.personas : (b.personas && b.personas.personas) || [])
    const pById = new Map(personas.map(p => [p.id, p]))
    const beatLabel = new Map((b.beats || []).map(x => [x.id, x.label]))
    let deliveries = null, lens = ''
    // the release notes the wire's vault publishes, when it does (data/releases.json, the contract in the brief)
    let releaseFile = null
    try { releaseFile = await r.readJson('data/releases.json') } catch (e) { releaseFile = null }
    // the verifier's records (data/factcheck-<date>.json, newest first): a row per story when the file has results[],
    // the file's own words otherwise; drawn at the story and in the edition's header, as written. The charter asks
    // for one row per story on every run (wire/charter.html).
    const checks = [], checkOf = new Map()
    try {
        const files = await r.files(['data'])
        for (const p of Object.keys(files).filter(p => /^data\/factcheck-[^/]+\.json$/.test(p)).sort().reverse()) {
            const f = await r.readJson(p), at = (/(\d{4}-\d{2}-\d{2})/.exec(p) || [])[1] || ''
            if (!f || typeof f !== 'object') continue
            checks.push({ path: p, at, file: f })
            for (const x of (Array.isArray(f.results) ? f.results : [])) if (x && x.story) checkOf.set(x.story, [...(checkOf.get(x.story) || []), { at, ...x }])
        }
    } catch (e) { /* no record: nothing drawn */ }
    // the lenses: the public personas, plus any named reader the site's config records as having agreed to be one
    const named = (cfg.named_readers || []).map(x => typeof x === 'string' ? x : x.persona).filter(id => pById.has(id))
    // the public lenses: the Industry Wire's fixed six; on a wire that describes itself, every persona but the personal one
    const publicLenses = b.wire ? personas.map(p => p.id).filter(id => id !== personal) : PUBLIC_LENSES
    const LENSES = [...publicLenses, ...named.filter(id => !publicLenses.includes(id))]
    if (b.stack) { try { deliveries = await r.readJson('data/deliveries.json') } catch (e) { deliveries = [] } }   // the stack section needs the join

    // the lens: the #lens= fragment, else the one this reader chose last time, else the active persona when it maps, else all
    const m = /lens=([a-z-]+)/.exec(location.hash)
    if (m && pById.has(m[1]) && LENSES.includes(m[1])) lens = m[1]
    else if (W.lens(scope) && pById.has(W.lens(scope)) && LENSES.includes(W.lens(scope))) lens = W.lens(scope)
    else { try { const s = JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'); const p = s && s.personas.find(x => x.id === s.active); if (p && PRESET_TO_WIRE[p.preset]) lens = PRESET_TO_WIRE[p.preset] } catch (e) { /* all */ } }

    // this visit, and every story of the edition recorded as seen; New is what was first seen in this visit
    const visit = W.visit(scope)
    W.markSeen([...byId.keys()], scope)
    const isNew = id => W.isNew(id, visit, scope)
    const decisionOf = id => N.forStory(location.pathname, id)[0] || null
    const filterKey = scope ? `${FILTER_KEY}:${scope}` : FILTER_KEY
    let filter = 'inbox'
    try { const f = sessionStorage.getItem(filterKey); if (FILTERS.some(([k]) => k === f)) filter = f } catch (e) { /* default */ }
    let lastKept = null

    const pname = id => { const p = pById.get(id); return p ? `${p.name}, ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}` : id }
    const first = id => pname(id).split(',')[0]
    const delivery = sid => deliveries && deliveries.find(d => d.story === sid && d.persona === lens)
    const reaches = sid => { if (!lens) return true; const d = delivery(sid); return !!d && d.status === 'reached' }
    const passes = id => {
        const d = decisionOf(id)
        if (filter === 'inbox') return !d
        if (filter === 'new') return isNew(id)
        if (filter === 'all') return true
        return !!d && d.kind === filter
    }
    const releases = W.releasesSince(releaseFile, visit.prev)
    // Updated: named by a release shown in the bar, or by the edition itself (brief.updated_in_edition); the story's own
    // changes[] (each { at, what }) is the correction as the desk recorded it, and is drawn under the story for as long as
    // the vault keeps it. Corrections must propagate: a corrected story says so where it is read, not only in a note.
    const updatedIds = new Set([...releases.flatMap(x => x.updated || []), ...(brief.updated_in_edition || [])])
    const changesOf = s => (Array.isArray(s.changes) ? s.changes : []).filter(c => c && (c.what || c.at))

    const keep = (kind, s, text = '') => {
        const rec = N.keep({ kind, story: s.id, title: s.headline, n: null, quote: '', text })   // redraws through the notes event
        if (rec) { lastKept = { id: rec.id, kind, headline: s.headline }; drawBar() }
    }
    const decide = (s, el, fold) => {
        const kept = decisionOf(s.id)
        const row = h('div', { class: 'decide', role: 'group', 'aria-label': 'Your decision' }, h('span', { class: 'k' }, kept ? 'You:' : 'You?'),
            ...(kept
                ? [h('span', { class: 'kept' }, N.kindLabel(kept.kind) + (kept.text ? ` — ${kept.text}` : '') + (kept.device ? ` (on ${kept.device})` : '')), kept.device ? null : h('button', { type: 'button', class: 'undo', onclick: () => N.remove(kept.id) }, 'undo')]
                : DECISIONS.map(k => h('button', { type: 'button', class: 'chip', 'data-kind': k, title: (N.KINDS.find(x => x.id === k) || {}).says || '', onclick: () => keep(k, s) }, N.kindLabel(k)))))
        el.classList.toggle('decided', !!kept && fold)
        return row
    }

    const card = (s, isLead) => {
        const d = lens ? delivery(s.id) : null
        const primary = s.primary || {}
        const el = h('article', { class: `story${s.primary_fetched === false ? ' unfetched' : ''}${isLead ? ' lead' : ''}${isNew(s.id) ? ' new' : ''}`, id: s.id },
            h('h3', {}, isNew(s.id) ? h('span', { class: 'flag new' }, 'New') : null, updatedIds.has(s.id) ? h('span', { class: 'flag upd' }, 'Updated') : null, isHttp(primary.url) ? linkText(tx(s, 'headline'), primary.url) : tx(s, 'headline')),
            h('p', { class: 'meta' }, [provenanceStrip(s), when(s.date), primary.publisher, s.primary_kind, s.confidence ? h('span', { class: `conf-${s.confidence}` }, `confidence ${s.confidence}`) : null, s.primary_fetched === false ? 'primary not fetched by the research agent' : null, s.edition && brief.edition && s.edition !== brief.edition ? `from the edition of ${s.edition}` : null]
                .filter(Boolean).flatMap((x, i) => i ? [' · ', x] : [x])),
            isLead && brief.lead && brief.lead.why_it_leads ? h('p', { class: 'leads' }, h('b', {}, 'Why it leads: '), brief.lead.why_it_leads) : null,
            s.summary ? h('p', {}, tx(s, 'summary')) : null,
            s.quote ? h('blockquote', {}, `“${s.quote}”`, h('cite', {}, isHttp(s.quote_source_url) ? linkText(hostOf(s.quote_source_url), s.quote_source_url) : 'source not given', langs.length > 1 && s.quote_lang ? h('span', { class: 'chip lang' }, `in ${String(s.quote_lang)}`) : null)) : null,
            s.why_it_matters ? h('p', { class: 'why' }, h('b', {}, 'Why it matters: '), tx(s, 'why_it_matters')) : null,
            changesOf(s).length ? h('ul', { class: 'changes', 'aria-label': 'Changed by the desk' }, changesOf(s).map(c => h('li', {}, h('span', { class: 'at' }, when(c.at)), ' ', c.what || ''))) : null,
            (checkOf.get(s.id) || []).length ? h('p', { class: 'check' }, h('b', {}, 'Checked independently: '), (checkOf.get(s.id) || []).map(x => [x.at, x.quote ? `quote ${x.quote}` : null, x.date ? `date ${x.date}` : null, x.version && x.version !== 'n/a' ? `version ${x.version}` : null, x.independence ? `independence ${x.independence}` : null, x.verdict ? `verdict ${x.verdict}` : null, x.fix ? `fix: ${x.fix}` : null].filter(Boolean).join(' · ')).join(' | ')) : null,
            (s.coverage || []).length ? h('details', {}, h('summary', {}, `Who else covered it (${s.coverage.length})${primary.title ? ', and the primary source' : ''}`),
                h('ul', { class: 'cov' },
                    primary.title ? h('li', {}, h('b', {}, 'Primary: '), isHttp(primary.url) ? linkText(primary.title, primary.url) : primary.title, primary.publisher ? `, ${primary.publisher}` : '', primary.date ? `, ${primary.date}` : '') : null,
                    s.coverage.map(c => h('li', {}, isHttp(c.url) ? linkText(c.title || c.url, c.url) : (c.title || ''), c.publisher ? `, ${c.publisher}` : '', c.date ? `, ${c.date}` : '', c.tier ? h('span', { class: 'chip' }, `tier ${c.tier}`) : null)))) : null,
            h('div', { class: 'chips' },
                ...['orgs', 'people', 'products', 'tech', 'cves'].flatMap(k => ((s.entities || {})[k] || []).map(e => h('span', { class: 'chip ent' }, e))),
                ...(s.personas || []).map(p => h('span', { class: 'chip' }, `for ${first(p)}`)),
                ...(d && d.status === 'reached' ? (d.connections || []).map(c => h('span', { class: 'chip reach' }, `${c.kind}: ${c.term} (+${c.weight})`)) : [])),
            s.status ? h('p', { class: 'status' }, s.status) : null)
        el.append(decide(s, el, filter === 'all' || filter === 'done'))
        return el
    }

    // the deadlines a stack carries (data/stack.json), soonest first, with the days left; drawn in the edition's header
    const deadlines = (b.stack && Array.isArray(b.stack.deadlines) ? b.stack.deadlines : []).filter(d => d && d.date).slice().sort((x, y) => String(x.date).localeCompare(String(y.date)))
    const daysTo = d => Math.round((Date.parse(d) - Date.now()) / 864e5)
    const lensBar = h('div', { class: 'lens', role: 'group', 'aria-label': 'Read as' }, h('span', { class: 'k' }, 'Read as'),
        h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(!lens), onclick: () => setLens('') }, 'Everyone'),
        ...LENSES.filter(id => pById.has(id)).map(id => h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(lens === id), onclick: () => setLens(id) }, pname(id))))
    const langBar = langs.length > 1 ? h('div', { class: 'lens langs', role: 'group', 'aria-label': 'Read in' }, h('span', { class: 'k' }, 'Read in'),
        ...langs.map(l => h('button', { type: 'button', class: 'btn sm', 'data-lang': l, 'aria-pressed': String(lang === l), onclick: () => {
            lang = l; try { localStorage.setItem(langKey, l) } catch (e) { /* fine */ }
            for (const btn of langBar.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.getAttribute('data-lang') === l))
            draw()
        } }, l.toUpperCase()))) : null
    const lensNote = h('p', { class: 'lens-note' })
    const bar = h('section', { class: 'inbox', id: 'wire-inbox', 'aria-label': 'Your inbox' })
    const body = h('div', {})
    const header = h('section', { class: 'edition' },
        h('p', { class: 'k' }, `Edition of ${brief.edition || '?'}`),
        h('p', { class: 'meta' }, [brief.kind, brief.window ? `covers ${brief.window.from} to ${brief.window.to}` : null, brief.status, brief.counts ? `${brief.counts.stories} stories from ${brief.counts.publishers} publishers` : null].filter(Boolean).join(' · ')),
        brief.editor_note ? h('p', { class: 'note' }, brief.editor_note) : null,
        brief.corrections ? h('p', { class: 'corrections' }, h('b', {}, 'Corrections and updates: '), brief.corrections) : null,
        checks.length ? h('div', { class: 'checks', id: 'wire-checks' }, h('b', {}, 'Checked independently. '), ...checks.map(({ path, at, file: f }) => h('p', {},
            `${f.checked_by || path}${f.method ? `: ${f.method}` : ''}${f.checked ? `: ${f.checked}` : ''}${f.result ? `. ${f.result}` : ''}`
            + (Array.isArray(f.results) ? `. ${f.results.length} ${f.results.length === 1 ? 'story' : 'stories'} checked, ${f.results.filter(x => x && x.verdict === 'fixed').length} fixed, each shown at its story` : '')
            + (f.not_checked ? `. Not checked: ${f.not_checked}` : '') + ` (${path.replace(/^data\//, '')}${at ? `, ${at}` : ''}).`))) : null,
        deadlines.length ? h('div', { class: 'deadlines', id: 'wire-deadlines' }, h('b', {}, 'Deadlines for your stack'), h('ul', {}, deadlines.map(d => { const n = daysTo(d.date); return h('li', {},
            h('span', { class: `dd${Number.isFinite(n) && n <= 30 ? ' soon' : ''}` }, when(d.date)), isHttp(d.source) ? linkText(d.what || d.source, d.source) : (d.what || ''),
            Number.isFinite(n) ? h('span', { class: 'then' }, n < 0 ? ` (${-n} days ago)` : n === 0 ? ' (today)' : ` (in ${n} days)`) : null, d.then ? h('span', { class: 'then' }, ` · then: ${d.then}`) : null) }))) : null,
        (brief.threads || []).length ? h('div', { class: 'threads' }, brief.threads.map(t => h('div', { class: 'thread' }, h('b', {}, t.title), t.note || '', h('div', { class: 'ids' }, (t.stories || []).filter(id => byId.has(id)).map(id => h('a', { href: `#${id}`, title: byId.get(id).headline }, id)))))) : null,
        // the edition as graphs (wire/graphs.js): the week by day and beat, the threads on a date axis, the entities two
        // or more stories share; each folded so the header stays the editor's note, each drawn from the bundle alone
        (b.stories || []).length ? h('details', { class: 'graph', id: 'wire-byday' }, h('summary', {}, 'Stories per day, the last 14 days, by beat'), storiesByDay(b.stories, { days: 14, beats: b.beats || [] })) : null,
        (brief.threads || []).length ? h('details', { class: 'graph', id: 'wire-threads' }, h('summary', {}, 'The threads on a date axis'), threadsTimeline(brief.threads, byId)) : null,
        (b.stories || []).length > 1 ? h('details', { class: 'graph', id: 'wire-entities' }, h('summary', {}, 'Who is named by more than one story'), cooccurrence(b.stories, { min: 2, max: 24 })) : null)

    async function setLens(id) {
        lens = id
        W.setLens(id, scope)
        for (const btn of lensBar.querySelectorAll('button')) btn.setAttribute('aria-pressed', String((btn.textContent === 'Everyone' && !id) || (id && btn.textContent === pname(id))))
        if (id && !deliveries) { try { deliveries = await r.readJson('data/deliveries.json') } catch (e) { deliveries = [] } }
        try { history.replaceState(null, '', id ? `#lens=${id}` : location.pathname) } catch (e) { /* fine */ }
        draw()
    }

    /** The bar: what arrived since the last visit, what the vault says changed, the filters, and what is only in this browser. */
    function drawBar() {
        const ids = [...byId.keys()], fresh = ids.filter(isNew)
        const freshFor = lens ? fresh.filter(reaches) : fresh, freshNot = lens ? fresh.filter(id => !reaches(id)) : []
        const count = k => ids.filter(id => { const d = decisionOf(id); return k === 'inbox' ? !d : k === 'new' ? isNew(id) : k === 'all' ? true : !!d && d.kind === k }).length
        const p = pending(), stamp = at => String(at || '').slice(0, 16).replace('T', ' ')
        const link = id => byId.has(id) ? h('a', { href: `#${id}`, title: byId.get(id).headline }, id) : h('span', { class: 'mono' }, id)
        bar.replaceChildren(...[
            h('p', { class: 'since', id: 'wire-since' },
                visit.prev ? `Since your last visit (${stamp(visit.prev)} UTC): ` : 'Your first visit to the wire in this browser: ',
                h('b', {}, `${fresh.length} new ${fresh.length === 1 ? 'story' : 'stories'}`),
                lens && fresh.length ? `, ${freshFor.length} for ${first(lens)} and ${freshNot.length} not for ${first(lens)}` : '',
                !lens && fresh.length ? '. Choose who you read as to split them into for you and not for you' : '',
                '.'),
            releases.length
                ? h('div', { class: 'releases', id: 'wire-releases' }, ...releases.map(x => h('div', { class: 'release' },
                    h('p', {}, h('b', {}, x.title || x.id || 'A release'), ` · ${stamp(x.at)} UTC`, x.edition ? ` · edition ${x.edition}` : ''),
                    x.summary ? h('p', { class: 'sum' }, x.summary) : null,
                    (x.added || []).length ? h('p', { class: 'ids' }, 'Added: ', ...(x.added || []).flatMap((id, i) => i ? [', ', link(id)] : [link(id)])) : null,
                    (x.updated || []).length ? h('p', { class: 'ids' }, 'Updated: ', ...(x.updated || []).flatMap((id, i) => i ? [', ', link(id)] : [link(id)])) : null)))
                : h('p', { class: 'releases none', id: 'wire-releases' }, 'What changed in the vault: ', r.message ? `the latest commit says “${shorten(r.message, 160)}”. ` : '', 'The vault does not publish release notes yet; ', h('a', { href: `${up}admin/notes/2026-10-13__the-wire-as-an-inbox.md#the-release-file`, 'data-site': '' }, 'the brief'), ' asks for them.'),
            h('div', { class: 'filters', role: 'group', 'aria-label': 'Show' }, ...FILTERS.map(([k, label]) => h('button', { type: 'button', class: 'btn sm', 'data-filter': k, 'aria-pressed': String(filter === k), onclick: () => { filter = k; try { sessionStorage.setItem(filterKey, k) } catch (e) { /* fine */ } draw() } }, `${label} (${count(k)})`))),
            lastKept && N.list().some(n => n.id === lastKept.id)
                ? h('p', { class: 'toast', id: 'wire-kept' }, `${N.kindLabel(lastKept.kind)}: ${shorten(lastKept.headline, 80)}. `, h('button', { type: 'button', class: 'undo', onclick: () => { N.remove(lastKept.id); lastKept = null } }, 'undo'))
                : null,
            p.any
                ? h('p', { class: 'pending', id: 'wire-pending' }, p.count ? `${p.count} change(s) only in this browser, ${describePending(p)}: not in your vault until you update it. ` : `Only in this browser: ${describePending(p)}. Update the vault so your other devices do not show them as new. `,
                    h('button', { type: 'button', class: 'btn sm primary', id: 'wire-update', onclick: () => window.dispatchEvent(new CustomEvent('sgit-vault-update')) }, 'Update the vault'), ' ',
                    h('button', { type: 'button', class: 'btn sm', onclick: () => window.dispatchEvent(new CustomEvent('sgit-vault-open', { detail: { tab: 'vault' } })) }, 'Open the vault'))
                : h('p', { class: 'pending ok', id: 'wire-pending' }, p.last ? `Everything you decided here is in your vault (last update ${stamp(p.last)} UTC).` : 'Nothing decided here yet.'),
        ].filter(Boolean))
    }

    function draw() {
        const p = lens && pById.get(lens)
        lensNote.textContent = p ? `${pname(lens)} reads for ${p.converts_news_into || 'their own reasons'}; stories reach them through a matched concern (${(p.concerns || []).map(c => c.label).join(', ')}), by the join recorded in the vault, not by this page.`
                                 : 'Every story of the edition, by beat. Choose a persona to see what reaches them and what was withheld, with the reason.'
        const beats = (brief.beats && brief.beats.length ? brief.beats : (b.beats || []).map(x => ({ id: x.id, label: x.label, stories: (b.stories || []).filter(s => s.beat === x.id).map(s => s.id) })))
        const leadId = brief.lead && brief.lead.story
        const sections = []
        let shownTotal = 0
        if (leadId && byId.has(leadId) && passes(leadId) && reaches(leadId)) { sections.push(h('h2', { class: 'beat' }, 'The lead'), h('div', { class: 'stories' }, card(byId.get(leadId), true))); shownTotal++ }
        let reached = 0, withheld = 0
        for (const bt of beats) {
            const ids = (bt.stories || []).map(x => typeof x === 'string' ? x : x.id).filter(id => byId.has(id) && id !== leadId)
            const shown = [], held = []
            for (const id of ids) {
                const d = lens ? delivery(id) : null, isHeld = lens && (!d || d.status !== 'reached')
                if (isHeld) withheld++; else reached++
                if (!passes(id)) continue
                if (isHeld) held.push([byId.get(id), d]); else shown.push(byId.get(id))
            }
            shownTotal += shown.length + held.length
            if (filter !== 'all' && !shown.length && !held.length) continue
            sections.push(h('h2', { class: 'beat', id: `beat-${bt.id}` }, bt.label || beatLabel.get(bt.id) || bt.id, h('span', { class: 'n' }, lens ? `${shown.length} reach ${first(lens)}, ${held.length} withheld` : `${shown.length} ${shown.length === 1 ? 'story' : 'stories'}`)),
                shown.length ? h('div', { class: 'stories' }, shown.map(s => card(s))) : h('p', { class: 'dim' }, 'Nothing in this beat reaches this reader.'),
                held.length ? h('details', { class: 'withheld', open: held.some(([s]) => isNew(s.id)) && filter === 'new' }, h('summary', {}, `Not for ${first(lens)} (${held.length}${held.some(([s]) => isNew(s.id)) ? `, ${held.filter(([s]) => isNew(s.id)).length} new` : ''}), and why`),
                    h('ul', {}, held.map(([s, d]) => {
                        const kept = decisionOf(s.id)
                        return h('li', { id: s.id }, isNew(s.id) ? h('span', { class: 'flag new' }, 'New') : null, updatedIds.has(s.id) ? h('span', { class: 'flag upd' }, 'Updated') : null, h('b', {}, s.headline), ' — ', d && d.withheld_reason ? d.withheld_reason : 'no delivery recorded for this reader', ' ',
                            kept ? h('span', { class: 'kept' }, `You: ${N.kindLabel(kept.kind)}`, kept.device ? '' : ' ', kept.device ? null : h('button', { type: 'button', class: 'undo', onclick: () => N.remove(kept.id) }, 'undo'))
                                 : h('span', { class: 'held-acts' }, h('button', { type: 'button', class: 'chip', 'data-kind': 'more-like-this', title: 'the join missed me: this should have reached me', onclick: () => keep('more-like-this', s, `should have reached me as ${first(lens)}`) }, 'Should reach me'), ' ', h('button', { type: 'button', class: 'chip', 'data-kind': 'done', onclick: () => keep('done', s) }, 'Done')))
                    }))) : null)
        }
        if (!shownTotal) sections.push(h('p', { class: 'empty', id: 'wire-empty' }, filter === 'inbox' ? 'Your inbox is empty: every story of this edition has a decision. That is the state the wire should return to.' : filter === 'new' ? 'Nothing new since your last visit.' : `No story is marked ${N.kindLabel(filter).toLowerCase()}.`))
        // the personal brief the vault wrote for a named reader, shown only under that reader's lens
        const pb = brief.personal
        const personal = lens && named.includes(lens) && pb && pb.persona === lens ? h('section', { class: 'personal' },
            h('p', { class: 'k' }, `The personal brief for ${first(lens)}, as the vault wrote it`),
            pb.note ? h('p', { class: 'note' }, pb.note) : null,
            (pb.top || []).some(t => byId.has(t.story)) ? h('ol', {}, (pb.top || []).filter(t => byId.has(t.story)).map(t => h('li', {},
                h('a', { href: `#${t.story}` }, byId.get(t.story).headline),
                t.score != null ? h('span', { class: 'chip' }, `score ${t.score}`) : null,
                (t.why || []).length ? h('span', { class: 'dim' }, ` · ${t.why.join('; ')}`) : null))) : null,
            h('p', { class: 'dim' }, 'A named reader, by their own agreement while the wire is a beta. Like everything in the vault, this brief is public.')) : null
        body.replaceChildren(...(personal ? [personal] : []), ...sections)
        drawBar()
        foot(lens ? `${reached} stories reach ${first(lens)}, ${withheld} withheld` : `${byId.size} stories in ${beats.length} beats`)
    }
    window.addEventListener(N.EVENT, () => draw())
    window.addEventListener('sgit-vault-updated', () => drawBar())
    setInterval(() => { if (document.visibilityState !== 'hidden') drawBar() }, 4000)       // the count of what is only in this browser
    const extras = [b.map ? mapSection(b.map, b.stories || []) : null, b.stack ? stackSection(b.stack, byId, deliveries) : null].filter(Boolean)
    mount.replaceChildren(header, lensBar, ...(langBar ? [langBar] : []), lensNote, bar, ...extras, body)
    if (lens) await setLens(lens); else draw()
}

// ------------------------------------------------------------ what a vault adds beyond the edition
/** A map (data/map.json: entities with aliases, facts, leaders, standards), each with the stories whose entities name it. */
function mapSection(map, stories) {
    const ents = Array.isArray(map.entities) ? map.entities.filter(e => e && (e.name || e.id)) : []
    if (!ents.length) return null
    const terms = s => { const o = new Set(); for (const v of Object.values(s.entities || {})) if (Array.isArray(v)) for (const t of v) o.add(String(t).toLowerCase()); return o }
    const sets = stories.map(s => [s, terms(s)])
    const naming = e => { const al = [e.name, ...(e.aliases || [])].filter(Boolean).map(x => String(x).toLowerCase()); return sets.filter(([, t]) => al.some(a => t.has(a))).map(([s]) => s) }
    const rows = ents.map(e => ({ e, ss: naming(e) })).sort((a, b) => b.ss.length - a.ss.length || String(a.e.name || a.e.id).localeCompare(String(b.e.name || b.e.id)))
    const namedBy = rows.filter(x => x.ss.length).length
    const storyList = ss => h('ul', { class: 'named' }, ss.map(s => h('li', {}, h('a', { href: `#${s.id}` }, s.headline), h('span', { class: 'dim' }, ` · ${when(s.date)}`))))
    return h('details', { class: 'extra map', id: 'wire-map' },
        h('summary', {}, `${map.title || 'The map'}: ${ents.length} ${ents.length === 1 ? 'entity' : 'entities'}, ${namedBy} named by a story in this edition`),
        map.intro ? h('p', {}, map.intro) : null,
        ...rows.map(({ e, ss }) => h('details', { class: 'ent' },
            h('summary', {}, e.name || e.id, h('span', { class: 'n' }, [e.kind, (e.facts || {}).Level, ss.length ? `${ss.length} ${ss.length === 1 ? 'story' : 'stories'}` : 'no story yet'].filter(Boolean).join(' · '))),
            Object.values(e.facts || {}).some(Boolean) ? h('dl', {}, ...Object.entries(e.facts).filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, isHttp(v) ? linkText(String(v), v) : String(v))])) : null,
            (e.leaders || []).length ? h('p', { class: 'aliases' }, `Leaders: ${e.leaders.join(', ')}`) : null,
            (e.standards || []).length ? h('p', { class: 'aliases' }, `Standards: ${e.standards.join(', ')}`) : null,
            e.notes ? h('p', { class: 'aliases' }, e.notes) : null,
            ss.length ? storyList(ss) : null)))
}

/** A stack (data/stack.json: the services a reader runs, with aliases and deadlines), each with the items the join says touched it. */
function stackSection(stack, byId, deliveries) {
    const services = Array.isArray(stack.services) ? stack.services.filter(s => s && (s.name || s.id)) : []
    if (!services.length) return null
    const touched = svc => (deliveries || []).filter(d => d.persona === stack.persona && d.status === 'reached' && (d.connections || []).some(c => c.concern === svc.id)).map(d => byId.get(d.story)).filter(Boolean)
    const extra = Array.isArray(stack.extra_concerns) ? stack.extra_concerns : [], deadlines = Array.isArray(stack.deadlines) ? stack.deadlines : []
    return h('details', { class: 'extra stack', id: 'wire-stack' },
        h('summary', {}, `Your stack: ${services.length} ${services.length === 1 ? 'service' : 'services'}${extra.length ? `, ${extra.length} more ${extra.length === 1 ? 'concern' : 'concerns'}` : ''}${deadlines.length ? `, ${deadlines.length} ${deadlines.length === 1 ? 'deadline' : 'deadlines'}` : ''}, as the vault declares it for ${stack.persona || 'its reader'}`),
        stack.what ? h('p', {}, stack.what) : null,
        ...services.map(svc => { const ss = touched(svc); return h('details', { class: 'ent' },
            h('summary', {}, svc.name || svc.id, h('span', { class: 'n' }, [svc.runtime, (svc.watch || []).length ? `watching ${svc.watch.join(', ')}` : null, ss.length ? `${ss.length} ${ss.length === 1 ? 'item' : 'items'} touched it` : 'nothing touched it in this edition'].filter(Boolean).join(' · '))),
            (svc.aliases || []).length ? h('p', { class: 'aliases' }, `Also known as: ${svc.aliases.join(', ')}`) : null,
            ss.length ? h('ul', { class: 'named' }, ss.map(s => h('li', {}, h('a', { href: `#${s.id}` }, s.headline), h('span', { class: 'dim' }, ` · ${when(s.date)}`)))) : null) }),
        ...extra.map(c => h('p', { class: 'aliases' }, `${c.label || c.id}: ${(c.terms || []).join(', ')}`)),
        stack.later ? h('p', {}, h('b', {}, 'Later: '), stack.later) : null)
}

// ------------------------------------------------------------ the sources
async function sources(r, mount, foot) {
    const b = await r.readJson('data/bundle.json')
    const beatLabel = new Map((b.beats || []).map(x => [x.id, x.label]))
    const rows = (b.sources || []).slice().sort((x, y) => (x.tier || 'Z').localeCompare(y.tier || 'Z') || String(x.name).localeCompare(String(y.name)))
    const tiers = { A: 0, B: 0, C: 0 }
    for (const s of rows) if (s.tier in tiers) tiers[s.tier]++
    // how many stories each source gave this edition: the primary's source id, else its publisher's name
    const gave = new Map()
    for (const st of (b.stories || [])) { const p = st.primary || {}; const k = p.source || p.publisher; if (k) gave.set(k, (gave.get(k) || 0) + 1) }
    const n = s => (gave.get(s.id) || 0) + (s.id !== s.name ? (gave.get(s.name) || 0) : 0)
    mount.replaceChildren(
        h('p', {}, `${rows.length} sources in the registry: ${tiers.A} in tier A (an open licence: the wire may keep and show the full text), ${tiers.B} in tier B (quote up to 25 words and link), ${tiers.C} in tier C (link only). A source is verified once a person has opened its licence page; the rest are provisional.`),
        h('div', { class: 'tablewrap srcs' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Source', 'Beats', 'Tier', 'Stories', 'Licence', 'Verified', 'Feed and notes'].map(x => h('th', {}, x)))),
            h('tbody', {}, rows.map(s => h('tr', {},
                h('td', {}, isHttp(s.url) ? linkText(s.name, s.url) : s.name),
                h('td', {}, (s.beats || []).map(x => beatLabel.get(x) || x).join(', ')),
                h('td', {}, h('span', { class: `tier ${s.tier || ''}` }, s.tier || '?')),
                h('td', { class: 'n' }, String(n(s))),
                h('td', {}, isHttp(s.licence_url) ? linkText(s.licence || 'licence', s.licence_url) : (s.licence || '')),
                h('td', {}, s.verified ? 'yes' : 'provisional'),
                h('td', {}, h('details', {}, h('summary', {}, 'details'), s.feed ? h('p', {}, h('b', {}, 'Feed: '), s.feed) : null, s.notes ? h('p', {}, s.notes) : null))))))))
    foot(`${rows.length} sources, ${[...gave.values()].reduce((a, c) => a + c, 0)} primaries this edition`)
}

// ------------------------------------------------------------ the documents
async function how(r, mount, foot) {
    const files = await r.files(['docs', 'pipeline'])
    const docs = Object.keys(files).filter(p => /^(docs|pipeline)\/.+\.md$/.test(p)).sort()
    if (!docs.length) throw new Error('the vault has no docs/*.md')
    const nav = h('div', { class: 'docs-nav', role: 'tablist' })
    const body = h('div', { class: 'doc-body' })
    const show = async p => {
        for (const btn of nav.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.p === p))
        body.replaceChildren(h('p', { class: 'dim' }, 'Reading…'))
        const text = await r.readText(p)
        body.innerHTML = markdown(text)          // the renderer escapes every character of text; only http(s) links survive as links
        body.prepend(h('p', { class: 'dim mono' }, `${p} · ${files[p].size.toLocaleString()} bytes, as committed to the vault`))
        try { history.replaceState(null, '', `#${p}`) } catch (e) { /* fine */ }
    }
    for (const p of docs) nav.append(h('button', { type: 'button', class: 'btn sm', 'data-p': p, onclick: () => show(p) }, p.replace(/^(docs|pipeline)\//, '').replace(/\.md$/, '')))
    mount.replaceChildren(nav, body)
    const want = decodeURIComponent(location.hash.slice(1))
    await show(docs.includes(want) ? want : (docs.find(p => /ARCHITECTURE/.test(p)) || docs[0]))
    foot(`${docs.length} documents`)
}

// ------------------------------------------------------------ who should know, and how to reach them
/**
 * By organisation route only, under the contact rules this site publishes (world-news-day/data/contact-rules.json):
 * what this site found itself (the config's routes, each from the organisation's own contact page, fetched and hashed),
 * what the desk adds to the vault (data/contacts.json, optional), and what the vault already carries: the map's
 * projects with their pages and repositories, and the sources' sites. Never a personal address.
 */
async function reach(r, mount, foot, cfg) {
    const b = await r.readJson('data/bundle.json')
    let fromVault = null
    try { fromVault = await r.readJson('data/contacts.json') } catch (e) { fromVault = null }
    const routes = Array.isArray(cfg.reach) ? cfg.reach : []
    const ents = (b.map && Array.isArray(b.map.entities)) ? b.map.entities : []
    const terms = s => { const o = new Set(); for (const v of Object.values(s.entities || {})) if (Array.isArray(v)) for (const x of v) o.add(String(x).toLowerCase()); return o }
    const sets = (b.stories || []).map(s => [s, terms(s)])
    const naming = e => { const al = [e.name, ...(e.aliases || [])].filter(Boolean).map(x => String(x).toLowerCase()); return sets.filter(([, t]) => al.some(x => t.has(x))).length }
    const addr = a => h('li', {}, h('code', {}, a.address || ''), a.role ? h('span', { class: 'chip' }, a.role) : null, a.says ? h('span', { class: 'dim' }, ` · the page says: “${a.says}”`) : null)
    const found = routes.length ? h('section', { class: 'reach-found', id: 'reach-found' },
        h('h2', {}, 'Routes this site found'),
        h('p', { class: 'dim' }, 'Each from the organisation’s own contact page, one hop, the page’s bytes hashed when fetched; a role address only, never a person’s. Where a page publishes no address, that is the result.'),
        ...routes.map(x => h('div', { class: 'route' },
            h('h3', {}, x.organisation || '?', x.for ? h('span', { class: 'n' }, ` · ${x.for}`) : null),
            isHttp(x.page) ? h('p', { class: 'dim mono' }, linkText(x.page_title || x.page, x.page), x.fetched ? ` · fetched ${x.fetched}` : '', x.sha256 ? ` · sha256 ${x.sha256}…` : '') : null,
            (x.addresses || []).length ? h('ul', { class: 'addrs' }, (x.addresses || []).map(addr)) : null,
            (x.also || []).length ? h('ul', { class: 'also' }, (x.also || []).map(y => h('li', {}, isHttp(y.url) ? linkText(y.label || y.url, y.url) : (y.label || '')))) : null,
            x.note ? h('p', { class: 'dim' }, x.note) : null))) : null
    const vaultRows = fromVault && Array.isArray(fromVault.organisations || fromVault.contacts || fromVault) ? (fromVault.organisations || fromVault.contacts || fromVault) : []
    const fromDesk = h('section', { class: 'reach-vault', id: 'reach-vault' },
        h('h2', {}, 'From the vault'),
        vaultRows.length
            ? h('ul', { class: 'addrs' }, vaultRows.map(o => h('li', {}, h('b', {}, o.organisation || o.name || o.id || '?'), isHttp(o.url) ? [' · ', linkText(hostOf(o.url), o.url)] : null,
                (o.addresses || []).length ? h('ul', {}, o.addresses.map(a => addr(typeof a === 'string' ? { address: a } : a))) : null, o.note ? h('p', { class: 'dim' }, o.note) : null)))
            : h('p', { class: 'dim' }, 'The desk has not added data/contacts.json to this vault yet; the brief for the desks asks for it under the same rules.'),
        ents.length ? [h('h3', {}, `${ents.length} ${ents.length === 1 ? 'entity' : 'entities'} in the vault’s map, each with its public page and repository`),
            h('ul', { class: 'addrs' }, ents.slice().sort((x, y) => String(x.name).localeCompare(String(y.name))).map(e => { const f = e.facts || {}, n = naming(e); return h('li', {}, h('b', {}, e.name || e.id),
                isHttp(f.Page) ? [' · ', linkText('page', f.Page)] : null, isHttp(f.Repository) ? [' · ', linkText('repository', f.Repository)] : null,
                (e.leaders || []).length ? h('span', { class: 'dim' }, ` · leaders: ${e.leaders.join(', ')}`) : null, n ? h('span', { class: 'chip' }, `${n} ${n === 1 ? 'story' : 'stories'}`) : null) }))] : null,
        (b.sources || []).length ? [h('h3', {}, `${b.sources.length} sources in the registry, each with its site`),
            h('ul', { class: 'addrs srcs-list' }, b.sources.slice().sort((x, y) => String(x.name).localeCompare(String(y.name))).map(s => h('li', {}, isHttp(s.url) ? linkText(s.name, s.url) : s.name, s.tier ? h('span', { class: 'chip' }, `tier ${s.tier}`) : null)))] : null)
    mount.replaceChildren(...[found, fromDesk].filter(Boolean))
    foot(`${routes.length} route(s) found by this site, ${vaultRows.length} from the desk, ${ents.length} in the map, ${(b.sources || []).length} sources`)
}

// ------------------------------------------------------------ every wire, day by day
/** One page, every vault: the releases published and the stories dated each day, newest day first. */
async function days(mount, cfg, say) {
    const wires = Array.isArray(cfg.wires) ? cfg.wires : []
    if (!wires.length) throw new Error('no wires are configured')
    const byDay = new Map(), opened = []
    const day = d => { const k = String(d || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return null; if (!byDay.has(k)) byDay.set(k, { stories: [], releases: [] }); return byDay.get(k) }
    for (const w of wires) {
        say(`Opening ${w.name || w.slug || 'the wire'}’s vault…`)
        const r = await new VaultReader(w).init()
        await r.open()
        const b = await r.readJson('data/bundle.json')
        let rel = null
        try { rel = await r.readJson('data/releases.json') } catch (e) { rel = null }
        const href = `${w.slug ? w.slug + '/' : ''}index.html`
        for (const s of (b.stories || [])) { const d = day(s.date); if (d) d.stories.push({ w, s, href: `${href}#${s.id}` }) }
        for (const x of ((rel && Array.isArray(rel.releases)) ? rel.releases : [])) { const d = day(x.at); if (d) d.releases.push({ w, x, href }) }
        opened.push({ w, head: String(r.head).replace(/^obj-cas-imm-/, ''), n: (b.stories || []).length, edition: (b.brief || {}).edition || '' })
    }
    const keys = [...byDay.keys()].sort().reverse()
    const total = [...byDay.values()].reduce((a, d) => a + d.stories.length, 0)
    const weekday = k => { try { return new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) } catch (e) { return k } }
    const chip = w => h('span', { class: 'chip wire' }, w.name || w.slug || 'wire')
    mount.replaceChildren(
        h('p', { class: 'dim' }, `${total} stories across ${wires.length} wires, dated over ${keys.length} days; the releases are the desks’ own notes of each publish. Read live from the vaults: `, ...opened.flatMap((o, i) => [i ? ', ' : '', h('a', { href: `${o.w.slug ? o.w.slug + '/' : ''}index.html`, 'data-site': '' }, o.w.name), ` (edition ${o.edition}, ${o.n} stories, commit `, h('span', { class: 'mono' }, o.head), ')']), '.'),
        ...keys.map(k => { const d = byDay.get(k); const pubs = new Set(d.stories.map(({ s }) => ((s.primary || {}).publisher) || '').filter(Boolean))
            return h('section', { class: 'day', id: `d-${k}` },
                h('h2', {}, weekday(k), h('span', { class: 'n' }, ` · ${d.stories.length} ${d.stories.length === 1 ? 'story' : 'stories'} from ${pubs.size} ${pubs.size === 1 ? 'publisher' : 'publishers'}${d.releases.length ? `, ${d.releases.length} ${d.releases.length === 1 ? 'release' : 'releases'}` : ''}`)),
                d.releases.length ? h('div', { class: 'releases' }, d.releases.map(({ w, x, href }) => h('p', {}, chip(w), ' ', h('b', {}, x.title || x.id || 'A release'), x.at ? ` · ${String(x.at).slice(11, 16)} UTC` : '', ` · ${(x.added || []).length} added, ${(x.updated || []).length} updated${(x.withdrawn || []).length ? `, ${x.withdrawn.length} withdrawn` : ''}`, ' · ', h('a', { href, 'data-site': '' }, 'the edition'), x.summary ? h('span', { class: 'sum' }, ` ${shorten(x.summary, 220)}`) : null))) : null,
                h('ul', { class: 'daylist' }, d.stories.sort((p, q) => String(p.w.slug).localeCompare(String(q.w.slug)) || String(p.s.id).localeCompare(String(q.s.id))).map(({ w, s, href }) => { const p = s.primary || {}
                    return h('li', {}, chip(w), ' ', h('a', { href, 'data-site': '' }, s.headline), p.publisher ? h('span', { class: 'dim' }, ` · ${p.publisher}`) : null, p.tier ? h('span', { class: 'chip' }, `tier ${p.tier}`) : null, s.primary_fetched === false ? h('span', { class: 'dim' }, ' · primary not fetched') : null) })))
        }))
    say(`Read ${opened.length} vaults at ${new Date().toISOString().slice(11, 16)} UTC: ${opened.map(o => `${o.w.vault_id} ${o.head}`).join(', ')}`)
}
