/**
 * wire.js: the Industry Wire, read from its vault and drawn on this site.
 *
 * The data is not on this site. It is in an encrypted sgit vault that the wire's agents write to, and this page
 * opens it in the browser with a published read key (admin/build/wire-vault.json, written into the page as
 * #wire-config), through wire/vault-reader.js. A commit to the vault is on this page within ref_ttl_s, with no
 * release of the site. What the page reads, and what it relies on, is written on wire/how.html.
 *
 * Everything from the vault is drawn as text, with createElement and textContent. A link is made only from a
 * value that is an http(s) address. The docs are read as markdown and rendered by the vendored renderer, which
 * escapes; the vault's own pre-rendered HTML is not used. The vault is writable by whoever holds its write key,
 * and this page treats what it reads as data from them, not as code.
 *
 *   data-wire="edition"   the edition, read as an inbox: what is new since the last visit, for the reader and not,
 *                         the vault's release note, filters (inbox, new, read later, follow up, done, everything),
 *                         a decision at each story; the editor's note, threads, the lead, the stories by beat, a lens
 *   data-wire="sources"   the source registry with its tiers
 *   data-wire="how"       the wire's own documents, from docs/*.md
 *
 * @module wire
 */
import { VaultReader, markdown } from './vault-reader.js'
import * as N from '../assets/vault-pane/notes.js'
import * as W from '../assets/vault-pane/wire-state.js'
import { pending, describePending } from '../assets/vault-pane/pending.js'

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
    const b = await r.readJson('data/bundle.json')
    const brief = b.brief || {}, byId = new Map((b.stories || []).map(s => [s.id, s]))
    const personas = (Array.isArray(b.personas) ? b.personas : (b.personas && b.personas.personas) || [])
    const pById = new Map(personas.map(p => [p.id, p]))
    const beatLabel = new Map((b.beats || []).map(x => [x.id, x.label]))
    let deliveries = null, lens = ''
    // the release notes the wire's vault publishes, when it does (data/releases.json, the contract in the brief)
    let releaseFile = null
    try { releaseFile = await r.readJson('data/releases.json') } catch (e) { releaseFile = null }
    // the lenses: the public personas, plus any named reader the site's config records as having agreed to be one
    const named = (cfg.named_readers || []).map(x => typeof x === 'string' ? x : x.persona).filter(id => pById.has(id))
    const LENSES = [...PUBLIC_LENSES, ...named.filter(id => !PUBLIC_LENSES.includes(id))]

    // the lens: the #lens= fragment, else the one this reader chose last time, else the active persona when it maps, else all
    const m = /lens=([a-z-]+)/.exec(location.hash)
    if (m && pById.has(m[1]) && LENSES.includes(m[1])) lens = m[1]
    else if (W.lens() && pById.has(W.lens()) && LENSES.includes(W.lens())) lens = W.lens()
    else { try { const s = JSON.parse(localStorage.getItem('sgit.meter.v1') || 'null'); const p = s && s.personas.find(x => x.id === s.active); if (p && PRESET_TO_WIRE[p.preset]) lens = PRESET_TO_WIRE[p.preset] } catch (e) { /* all */ } }

    // this visit, and every story of the edition recorded as seen; New is what was first seen in this visit
    const visit = W.visit()
    W.markSeen([...byId.keys()])
    const isNew = id => W.isNew(id, visit)
    const decisionOf = id => N.forStory(location.pathname, id)[0] || null
    let filter = 'inbox'
    try { const f = sessionStorage.getItem(FILTER_KEY); if (FILTERS.some(([k]) => k === f)) filter = f } catch (e) { /* default */ }
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
    const updatedIds = new Set(releases.flatMap(x => x.updated || []))

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
            h('h3', {}, isNew(s.id) ? h('span', { class: 'flag new' }, 'New') : null, updatedIds.has(s.id) ? h('span', { class: 'flag upd' }, 'Updated') : null, isHttp(primary.url) ? linkText(s.headline, primary.url) : s.headline),
            h('p', { class: 'meta' }, [when(s.date), primary.publisher, s.primary_kind, s.confidence ? h('span', { class: `conf-${s.confidence}` }, `confidence ${s.confidence}`) : null, s.primary_fetched === false ? 'primary not fetched by the research agent' : null]
                .filter(Boolean).flatMap((x, i) => i ? [' · ', x] : [x])),
            isLead && brief.lead && brief.lead.why_it_leads ? h('p', { class: 'leads' }, h('b', {}, 'Why it leads: '), brief.lead.why_it_leads) : null,
            s.summary ? h('p', {}, s.summary) : null,
            s.quote ? h('blockquote', {}, `“${s.quote}”`, h('cite', {}, isHttp(s.quote_source_url) ? linkText(hostOf(s.quote_source_url), s.quote_source_url) : 'source not given')) : null,
            s.why_it_matters ? h('p', { class: 'why' }, h('b', {}, 'Why it matters: '), s.why_it_matters) : null,
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

    const lensBar = h('div', { class: 'lens', role: 'group', 'aria-label': 'Read as' }, h('span', { class: 'k' }, 'Read as'),
        h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(!lens), onclick: () => setLens('') }, 'Everyone'),
        ...LENSES.filter(id => pById.has(id)).map(id => h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(lens === id), onclick: () => setLens(id) }, pname(id))))
    const lensNote = h('p', { class: 'lens-note' })
    const bar = h('section', { class: 'inbox', id: 'wire-inbox', 'aria-label': 'Your inbox' })
    const body = h('div', {})
    const header = h('section', { class: 'edition' },
        h('p', { class: 'k' }, `Edition of ${brief.edition || '?'}`),
        h('p', { class: 'meta' }, [brief.kind, brief.window ? `covers ${brief.window.from} to ${brief.window.to}` : null, brief.status, brief.counts ? `${brief.counts.stories} stories from ${brief.counts.publishers} publishers` : null].filter(Boolean).join(' · ')),
        brief.editor_note ? h('p', { class: 'note' }, brief.editor_note) : null,
        (brief.threads || []).length ? h('div', { class: 'threads' }, brief.threads.map(t => h('div', { class: 'thread' }, h('b', {}, t.title), t.note || '', h('div', { class: 'ids' }, (t.stories || []).filter(id => byId.has(id)).map(id => h('a', { href: `#${id}`, title: byId.get(id).headline }, id)))))) : null)

    async function setLens(id) {
        lens = id
        W.setLens(id)
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
                : h('p', { class: 'releases none', id: 'wire-releases' }, 'What changed in the vault: ', r.message ? `the latest commit says “${shorten(r.message, 160)}”. ` : '', 'The vault does not publish release notes yet; ', h('a', { href: '../admin/notes/2026-10-13__the-wire-as-an-inbox.md#the-release-file', 'data-site': '' }, 'the brief'), ' asks for them.'),
            h('div', { class: 'filters', role: 'group', 'aria-label': 'Show' }, ...FILTERS.map(([k, label]) => h('button', { type: 'button', class: 'btn sm', 'data-filter': k, 'aria-pressed': String(filter === k), onclick: () => { filter = k; try { sessionStorage.setItem(FILTER_KEY, k) } catch (e) { /* fine */ } draw() } }, `${label} (${count(k)})`))),
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
                        return h('li', { id: s.id }, isNew(s.id) ? h('span', { class: 'flag new' }, 'New') : null, h('b', {}, s.headline), ' — ', d && d.withheld_reason ? d.withheld_reason : 'no delivery recorded for this reader', ' ',
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
    mount.replaceChildren(header, lensBar, lensNote, bar, body)
    if (lens) await setLens(lens); else draw()
}

// ------------------------------------------------------------ the sources
async function sources(r, mount, foot) {
    const b = await r.readJson('data/bundle.json')
    const beatLabel = new Map((b.beats || []).map(x => [x.id, x.label]))
    const rows = (b.sources || []).slice().sort((x, y) => (x.tier || 'Z').localeCompare(y.tier || 'Z') || String(x.name).localeCompare(String(y.name)))
    const tiers = { A: 0, B: 0, C: 0 }
    for (const s of rows) if (s.tier in tiers) tiers[s.tier]++
    mount.replaceChildren(
        h('p', {}, `${rows.length} sources in the registry: ${tiers.A} in tier A (an open licence: the wire may keep and show the full text), ${tiers.B} in tier B (quote up to 25 words and link), ${tiers.C} in tier C (link only). A source is verified once a person has opened its licence page; the rest are provisional.`),
        h('div', { class: 'tablewrap srcs' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Source', 'Beats', 'Tier', 'Licence', 'Verified', 'Feed and notes'].map(x => h('th', {}, x)))),
            h('tbody', {}, rows.map(s => h('tr', {},
                h('td', {}, isHttp(s.url) ? linkText(s.name, s.url) : s.name),
                h('td', {}, (s.beats || []).map(x => beatLabel.get(x) || x).join(', ')),
                h('td', {}, h('span', { class: `tier ${s.tier || ''}` }, s.tier || '?')),
                h('td', {}, isHttp(s.licence_url) ? linkText(s.licence || 'licence', s.licence_url) : (s.licence || '')),
                h('td', {}, s.verified ? 'yes' : 'provisional'),
                h('td', {}, h('details', {}, h('summary', {}, 'details'), s.feed ? h('p', {}, h('b', {}, 'Feed: '), s.feed) : null, s.notes ? h('p', {}, s.notes) : null))))))))
    foot(`${rows.length} sources`)
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
