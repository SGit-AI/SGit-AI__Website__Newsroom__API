/**
 * sg-meter — a reading meter for any website, kept entirely in the reader's browser.
 *
 * One element, eleven views, one shared meter (sg-meter-core.js):
 *
 *   <sg-meter view="balance"></sg-meter>      the balance, as a link to the account; put it in the nav
 *   <sg-meter view="page" kind="article" date="2026-10-10" topics="a b" title="…"></sg-meter>
 *                                             opens this page on the meter and charges it by scroll
 *                                             depth; shows what it cost and a "don't charge me" choice.
 *                                             Add `quiet` to charge without showing anything.
 *   <sg-meter view="account"></sg-meter>      balance, picks, topics, history, receipts, actions
 *   <sg-meter view="topup"></sg-meter>        the payment link if one is configured, else a simulated cart
 *   <sg-meter view="topped-up"></sg-meter>    the page a payment link returns to; adds the top-up once per
 *                                             session id (unverified, by design, and documented)
 *   <sg-meter view="picks"></sg-meter>        unread pages for the active persona; hidden until there is
 *                                             something to pick from
 *   <sg-meter view="newsroom"></sg-meter>     the reader's own front page: their personas, the picks for the
 *                                             active one, what they kept in it, and its graph      (v1.1)
 *   <sg-meter view="personas"></sg-meter>     add, rename, switch and remove personas; start from a preset (v1.1)
 *   <sg-meter view="graph" persona="me"></sg-meter>
 *                                             a persona drawn as a graph: topics, the pages behind them and
 *                                             the links between those pages                         (v1.1)
 *   <sg-meter view="link"></sg-meter>         one line linking to the newsroom, as the active persona (v1.1)
 *   <sg-meter view="share"></sg-meter>        show the reader exactly what their reading looks like, copy it, or
 *                                             send it, with their name and email, encrypted to the site (v1.2)
 *
 * It is an honesty box, not a paywall: it never blocks, it lets credit go below zero, and it says
 * on every view that it lives in this browser only. Data from the page and the reader is only
 * ever set with textContent.
 *
 * @module sg-meter
 * @version 1.2.0
 */

import { SgComponent } from '../../../../base/v1/v1.0/v1.0.0/sg-component.js'
import { meter, REASONS } from './sg-meter-core.js'

const SVG = 'http://www.w3.org/2000/svg'
const slugOf = p => String(p || '').replace(/^.*\//, '').replace(/\.html$/, '')

// ------------------------------------------------------------ the envelope (v1.2)
// sgit's hybrid envelope v2 with Web Crypto, as assets/subscribe.js and sgit_ai PKI__Crypto do it:
// a fresh AES-256-GCM key wrapped with RSA-OAEP-SHA256 to the recipient's public key. The .enc
// text is base64 of {v:2, w, i, c}; the lane payload is base64 of the .enc text's bytes.
const te = new TextEncoder()
const b64 = bytes => { let s = ''; for (const x of new Uint8Array(bytes)) s += String.fromCharCode(x); return btoa(s) }
const der = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0)).buffer
async function fingerprint(pem) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', der(pem)))
    return 'sha256:' + [...h].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
async function envelope(pem, text) {
    const pub = await crypto.subtle.importKey('spki', der(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    const iv  = crypto.getRandomValues(new Uint8Array(12))
    const c   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, te.encode(text))
    const w   = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, await crypto.subtle.exportKey('raw', aes))
    const enc = btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }))
    return btoa(enc)
}
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim()

/** Build an element: h('a', { href, class }, 'text', child, …). Strings become text nodes. */
function h(tag, attrs, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v == null) continue
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
        else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}

class SgMeter extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-meter' }

    onReady() {
        this._view = this.getAttribute('view') || 'balance'
        this._box  = this.$('.root')
        this._box.setAttribute('data-view', this._view)
        if (this._view === 'page') this._openPage()
        if (this._view === 'topped-up') this._toppedUp()
        this._paint()
        document.addEventListener('sg:meter.changed', () => this._paint())
    }

    get _root() { return meter.cfg.root }

    /** Replace the view's content; null and false are skipped, as in h(). */
    _set(...kids) { this._box.replaceChildren(...kids.flat().filter(k => k != null && k !== false)) }

    _paint() {
        const fn = {
            'balance'   : () => this._balance(),
            'page'      : () => this._page(),
            'account'   : () => this._account(),
            'topup'     : () => this._topup(),
            'topped-up' : () => {},
            'picks'     : () => this._picks(),
            'newsroom'  : () => this._newsroom(),
            'personas'  : () => this._personas(),
            'graph'     : () => this._graph(),
            'link'      : () => this._link(),
            'share'     : () => this._share(),
        }[this._view]
        if (fn) fn()
    }

    // ------------------------------------------------------------ balance
    _balance() {
        const s = meter.state
        const neg = s.balance < 0
        this._set(h('a', {
            class : `pill${neg ? ' neg' : ''}${s.paused ? ' paused' : ''}`,
            href  : this._root + meter.cfg.links.account,
            title : neg ? `You have read ${meter.money(-s.balance)} more than your credit. Nothing is blocked; top up whenever it feels fair. Kept in this browser only.`
                        : 'Your reading credit, kept in this browser only',
            'aria-label': `Reading credit ${meter.money(s.balance)}`,
        }, meter.money(s.balance)))
    }

    // ------------------------------------------------------------ page
    _openPage() {
        meter.open({
            kind   : this.getAttribute('kind') || 'page',
            date   : this.getAttribute('date') || '',
            topics : (this.getAttribute('topics') || '').split(' ').filter(Boolean),
            title  : this.getAttribute('title') || document.title,
        })
        const measure = () => {
            const el   = document.querySelector('main') || document.body
            const rect = el.getBoundingClientRect()
            meter.reach((window.innerHeight - rect.top) / (rect.height || 1))
        }
        measure()
        let wait = false
        window.addEventListener('scroll', () => {
            if (wait) return
            wait = true
            setTimeout(() => { wait = false; measure() }, 400)
        }, { passive: true })
        window.addEventListener('pagehide', measure)
    }

    _page() {
        const e = meter.entry
        if (this.hasAttribute('quiet') || meter.status === 'free' || meter.status === 'idle') { this.hidden = true; return }
        if (meter.status === 'paused') { this._set(h('span', { class: 'dim' }, 'The reading meter is paused.')); return }
        if (meter.status === 'declined' || (e && e.declined)) {
            const why = (REASONS.find(r => r[0] === e.declined.reason) || ['', 'no reason given'])[1]
            this._set(h('span', {}, h('b', {}, 'Not charged. '), `You said: ${why}. Kept in your history, in this browser only.`))
            return
        }
        if (!e) return
        const open = this._reasonsOpen
        const slug = slugOf(location.pathname)
        const kept = meter.curation(slug) === 'on'
        const keep = e.kind === 'article'
            ? h('button', { type: 'button', class: 'link', 'aria-pressed': kept ? 'true' : 'false',
                            onclick: () => meter.curate(slug, kept ? '' : 'on') }, kept ? 'Kept in your persona ✓' : 'Keep in your persona')
            : null
        this._set(
            h('span', {}, 'This page has cost you ', h('b', {}, meter.pence(e.cost)), ` so far, for ${Math.round(e.depth * 100)}% of it read (${meter.pence(e.price)} to the end). `,
              h('a', { href: this._root + meter.cfg.links.account }, 'Your account')),
            h('button', { type: 'button', class: 'link', onclick: () => { this._reasonsOpen = !open; this._page() } },
              open ? 'Keep paying' : 'Not worth it? Don’t charge me'),
            keep,
            open ? h('span', { class: 'reasons', role: 'group', 'aria-label': 'Why not?' },
                REASONS.map(([id, label]) => h('button', { type: 'button', class: 'btn', onclick: () => meter.decline(id) }, label))) : null,
        )
    }

    // ------------------------------------------------------------ picks
    async _picks() {
        const feed = await meter.feed()
        if (!feed || meter.profile(feed).total <= 0) { this.hidden = true; return }
        const list = meter.picks(feed, Number(this.getAttribute('count') || 4))
        if (!list.length) { this.hidden = true; return }
        this.hidden = false
        this._set(
            h('h2', { class: 'sect' }, 'Picked for you ', h('a', { href: this._root + meter.cfg.links2.newsroom }, 'your newsroom →')),
            this._pickList(feed, list),
        )
    }

    _pickList(feed, list) {
        return h('div', { class: 'picks' }, list.map(a => h('a', { class: 'pick', href: this._root + meter.cfg.picks.base + a.slug + '.html' },
            h('span', { class: 'meta' }, `${a.date} · ${meter.topicLabel(feed, (a.topics || [])[0])} · up to ${meter.pence(meter.priceOf({ kind: 'article', date: a.date }))}`),
            h('b', {}, a.title),
            h('span', {}, a.teaser))))
    }

    // ------------------------------------------------------------ account
    _topupAction() {
        const t = meter.cfg.topup
        return t.link ? h('a', { class: 'btn primary', href: t.link }, `Top up ${meter.money(t.amount)}`)
                      : h('a', { class: 'btn primary', href: this._root + meter.cfg.links.topup }, 'Top up')
    }

    async _account() {
        const s   = meter.state
        const feed = await meter.feed()
        const p   = meter.profile(feed, 'me')
        const neg = s.balance < 0
        const card = h('div', { class: 'card' },
            h('div', {},
                h('span', { class: 'dim' }, neg ? 'Read beyond your credit' : 'Balance'),
                h('b', { class: `big${neg ? ' neg' : ''}` }, meter.money(s.balance)),
                h('span', { class: 'dim' }, `${s.reads} page${s.reads === 1 ? '' : 's'} opened · ${meter.money(s.spent)} spent`
                    + (s.declined ? ` · ${meter.money(s.declined)} not charged at your request` : '') + (s.paused ? ' · meter paused' : '')),
                neg ? h('span', { class: 'dim' }, 'Nothing is blocked, and nothing will be. Top up when it feels fair.') : null),
            h('div', { class: 'actions' },
                this._topupAction(),
                h('button', { type: 'button', class: 'btn', onclick: () => meter.togglePause() }, s.paused ? 'Resume the meter' : 'Pause the meter'),
                h('button', { type: 'button', class: 'btn', onclick: () => this._export() }, 'Export as JSON'),
                h('button', { type: 'button', class: 'btn', onclick: () => {
                    if (confirm(`Clear the balance, the history and the receipts kept in this browser, and start again with ${meter.money(meter.cfg.start)}?`)) meter.reset()
                } }, 'Start again')))
        const topics = Object.keys(p.weights).filter(t => p.weights[t] > 0).sort((a, b) => p.weights[b] - p.weights[a])
        const topicSum = topics.reduce((n, t) => n + p.weights[t], 0) || 1
        const topicRows = topics.map(t => {
            const pc = Math.round(100 * p.weights[t] / topicSum)
            return h('div', { class: 'topic' }, h('span', { 'data-topic': t }, t), h('i', { style: `width:${pc}%` }), h('em', {}, `${pc}%`))
        })
        const rows = s.log.slice(0, 80).map(e => h('tr', {},
            h('td', {}, e.at.slice(0, 16).replace('T', ' ')),
            h('td', {}, h('a', { href: e.path }, String(e.title || e.path).replace(/, (sgit\.ai|SGit Newsroom)$/, ''))),
            h('td', {}, e.kind),
            h('td', {}, e.declined ? h('span', { class: 'dim' }, `not charged (${e.declined.reason})`)
                : `${meter.pence(e.cost)} (${Math.round((e.depth == null ? 1 : e.depth) * 100)}%)`)))
        const tops = s.topups.map(t => h('li', {}, h('b', {}, t.ref), ` ${t.at.slice(0, 16).replace('T', ' ')}: ${meter.money(t.credit)} of credit, `
            + (t.source === 'link' ? 'from the payment page (not verified by this page)' : 'simulated, nothing charged')))
        this._set(
            card,
            meter.noStorage ? h('p', { class: 'warn' }, 'This browser is not keeping a balance (storage is blocked), so the meter starts again on every page.') : null,
            h('div', { class: 'go' },
                h('a', { class: 'btn primary', href: this._root + meter.cfg.links2.newsroom }, 'Your newsroom →'),
                h('a', { class: 'btn', href: this._root + meter.cfg.links2.personas }, `Your personas (${s.personas.length})`),
                meter.cfg.links2.share ? h('a', { class: 'btn', href: this._root + meter.cfg.links2.share }, 'Send us your reading') : null,
                h('span', { class: 'dim' }, 'What was picked for you has moved to your newsroom, one front page per persona.')),
            h('h2', { id: 'graph' }, 'Your graph, as it grows'),
            h('p', { class: 'dim' }, 'Every page you read, attached to its topics and linked to the pages it cites. This is the "me" persona: all of your reading. It is drawn here, from the history below, and exists nowhere else.'),
            h('sg-meter', { view: 'graph', persona: 'me' }),
            h('h2', { id: 'topics' }, 'What your reading is about, by topic'),
            topicRows.length ? topicRows : h('p', { class: 'dim' }, 'Nothing yet.'),
            h('h2', { id: 'history' }, 'History'),
            rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('tr', {}, ['When', 'Page', 'Kind', 'Cost (read)'].map(x => h('th', {}, x))), rows))
                        : h('p', { class: 'dim' }, 'No pages read yet in this browser.'),
            h('h2', { id: 'receipts' }, 'Top-ups'),
            tops.length ? h('ul', {}, tops) : h('p', { class: 'dim' }, `None yet. You started with ${meter.money(meter.cfg.start)} of credit.`),
            h('h2', { id: 'restore' }, 'Move it to another browser'),
            h('p', { class: 'dim' }, 'Nothing follows you between devices yet. To take your balance, history and personas to another browser, export them above and restore the file there. A backup you have never restored is not a backup.'),
            h('label', { class: 'btn' }, 'Restore from an export…', h('input', { type: 'file', accept: 'application/json,.json', class: 'file', onchange: ev => this._restore(ev) })),
            this._restoreMsg ? h('p', { class: this._restoreErr ? 'warn' : 'dim' }, this._restoreMsg) : null,
        )
        if (feed) this.$$('[data-topic]').forEach(el => { el.textContent = meter.topicLabel(feed, el.getAttribute('data-topic')) })
    }

    _restore(ev) {
        const file = ev.target.files && ev.target.files[0]
        if (!file) return
        file.text().then(text => {
            if (!confirm('Replace the balance, history and personas in this browser with the ones in this file?')) return
            const err = meter.restore(text)
            this._restoreErr = !!err
            this._restoreMsg = err || `Restored: ${meter.state.reads} pages, ${meter.state.personas.length} persona${meter.state.personas.length === 1 ? '' : 's'}.`
            this._paint()
        })
    }

    // ------------------------------------------------------------ personas (v1.1)
    _chip(p, prof, active) {
        const theme = meter.personaTheme(p)
        return h('button', { type: 'button', class: `chip${active ? ' on' : ''}`, 'aria-pressed': active ? 'true' : 'false',
                             style: theme ? `--pc:${theme}` : null, onclick: () => meter.setActive(p.id) },
            h('i', { class: 'dot' }), meter.personaName(p, prof))
    }

    _pickCard(feed, a) {
        const id = meter.state.active
        return h('div', { class: 'pickwrap' },
            this._pickList(feed, [a]).firstChild,
            h('div', { class: 'pact' },
                h('button', { type: 'button', class: 'btn sm', onclick: () => meter.curate(a.slug, 'on', id) }, 'Keep'),
                h('button', { type: 'button', class: 'btn sm', onclick: () => meter.curate(a.slug, 'off', id) }, 'Not for this persona')))
    }

    async _newsroom() {
        const feed = await meter.feed()
        if (!feed) { this._set(h('p', { class: 'warn' }, 'The list of articles could not be loaded, so there is nothing to pick from.')); return }
        const s    = meter.state
        const prof = meter.profile(feed)
        const p    = prof.persona
        const pre  = p.preset && meter.preset(p.preset)
        const name = meter.personaName(p, prof)
        const theme = meter.personaTheme(p)
        const bySlug = new Map(feed.articles.map(a => [a.slug, a]))
        const list = meter.picks(feed, Number(this.getAttribute('count') || 9))
        const kept = p.on.map(x => bySlug.get(x)).filter(Boolean)
        const out  = p.off.map(x => bySlug.get(x)).filter(Boolean)
        const chips = s.personas.map(x => this._chip(x, x.id === p.id ? prof : meter.profile(feed, x.id), x.id === p.id))
        this._set(
            h('div', { class: 'chips', role: 'group', 'aria-label': 'Your personas' }, chips,
              h('a', { class: 'chip add', href: this._root + meter.cfg.links2.personas }, '+ Add or manage personas')),
            meter.cfg.links2.share ? h('a', { class: 'golink deal', href: this._root + meter.cfg.links2.share },
              h('span', { class: 'k' }, 'A newsroom designed for you'),
              h('span', {}, 'Read as you normally would, then send us what you read: we reply with what your front page could look like →')) : null,
            h('div', { class: 'persona', style: theme ? `--pc:${theme}` : null },
                h('span', { class: 'dim' }, p.id === 'me' ? 'Your default persona: everything you read' : pre ? `Started from the preset “${pre.label}”` : 'A persona of your own'),
                h('b', { class: 'pname' }, name),
                h('span', {}, pre ? pre.blurb : p.id === 'me'
                    ? 'Built from every page you read, weighted by how much of it you read. Its name comes from the topics you read most, until you give it one.'
                    : 'It grows from what you read while it is active, and from what you keep in it or put out of it.'),
                h('span', { class: 'dim' }, `${prof.reads.length} page${prof.reads.length === 1 ? '' : 's'} read as this persona · ${kept.length} kept · ${out.length} put out`)),
            h('h2', { class: 'sect' }, `Picked for ${name}`),
            list.length ? h('div', { class: 'picks' }, list.map(a => this._pickCard(feed, a)))
                : h('p', { class: 'dim' }, prof.total > 0 ? 'Nothing unread left in this persona’s topics.'
                    : 'Nothing to pick from yet. Read a few pages as this persona, or start another one from the personas below.'),
            kept.length ? h('h2', { class: 'sect' }, 'Kept in this persona') : null,
            kept.length ? h('ul', { class: 'curated' }, kept.map(a => h('li', {},
                h('a', { href: this._root + meter.cfg.picks.base + a.slug + '.html' }, a.title), ' ',
                h('button', { type: 'button', class: 'link', onclick: () => meter.curate(a.slug, '') }, 'remove')))) : null,
            out.length ? h('h2', { class: 'sect' }, 'Put out of this persona') : null,
            out.length ? h('ul', { class: 'curated' }, out.map(a => h('li', {},
                h('span', { class: 'dim' }, a.title), ' ',
                h('button', { type: 'button', class: 'link', onclick: () => meter.curate(a.slug, '') }, 'bring back')))) : null,
            h('h2', { class: 'sect' }, `${name}, as a graph`),
            h('sg-meter', { view: 'graph', persona: p.id }),
            p.id === 'me' && s.personas.length === 1 ? this._presetCards(feed) : null,
        )
    }

    _presetCards(feed) {
        const have = new Set(meter.state.personas.map(p => p.preset).filter(Boolean))
        const presets = (meter.cfg.personas.presets || []).filter(x => !have.has(x.id))
        return h('div', {},
            h('h2', { class: 'sect' }, 'Start another persona'),
            h('div', { class: 'presets' }, presets.map(x => h('div', { class: 'preset', style: x.theme ? `--pc:${x.theme}` : null },
                h('b', {}, meter.presetName(x)),
                h('span', {}, x.blurb),
                h('span', { class: 'dim' }, `Starts from ${(x.articles || []).length} articles`),
                h('button', { type: 'button', class: 'btn sm', onclick: () => meter.addPersona(x.id) }, 'Add this persona'))),
              h('div', { class: 'preset' },
                h('b', {}, 'A blank persona'),
                h('span', {}, 'Starts from nothing and becomes whatever you read while it is active.'),
                h('button', { type: 'button', class: 'btn sm', onclick: () => meter.addPersona('') }, 'Add a blank persona'))))
    }

    async _personas() {
        const feed = await meter.feed()
        const s = meter.state
        const rows = s.personas.map(p => {
            const prof = meter.profile(feed, p.id)
            const active = p.id === s.active
            const theme = meter.personaTheme(p)
            const input = h('input', { type: 'text', class: 'name', value: p.name, placeholder: meter.personaName({ ...p, name: '' }, prof), 'aria-label': 'Persona name', maxlength: '60' })
            return h('div', { class: `prow${active ? ' on' : ''}`, style: theme ? `--pc:${theme}` : null },
                h('i', { class: 'dot' }),
                h('div', { class: 'pmain' },
                    h('b', {}, meter.personaName(p, prof)),
                    h('span', { class: 'dim' }, `${p.id === 'me' ? 'Default, built from all your reading' : p.preset ? `From the preset “${meter.preset(p.preset) ? meter.preset(p.preset).label : p.preset}”` : 'Your own'} · ${prof.reads.length} read · ${p.on.length} kept · ${p.off.length} out`),
                    h('span', { class: 'rename' }, input,
                      h('button', { type: 'button', class: 'btn sm', onclick: () => meter.renamePersona(p.id, input.value) }, 'Rename'))),
                h('div', { class: 'actions' },
                    active ? h('span', { class: 'dim' }, 'Active') : h('button', { type: 'button', class: 'btn sm', onclick: () => meter.setActive(p.id) }, 'Make active'),
                    h('a', { class: 'btn sm', href: this._root + meter.cfg.links2.newsroom, onclick: () => meter.setActive(p.id) }, 'Open its newsroom'),
                    p.id === 'me' ? null : h('button', { type: 'button', class: 'btn sm', onclick: () => {
                        if (confirm(`Remove ${meter.personaName(p, prof)}? What you read stays in your history.`)) meter.removePersona(p.id)
                    } }, 'Remove')))
        })
        this._set(h('div', { class: 'plist' }, rows), feed ? this._presetCards(feed) : null)
    }

    // ------------------------------------------------------------ the graph (v1.1)
    async _graph() {
        const feed = await meter.feed()
        if (!feed) { this.hidden = true; return }
        const pid  = this.getAttribute('persona') || meter.state.active
        const prof = meter.profile(feed, pid)
        const bySlug = new Map(feed.articles.map(a => [a.slug, a]))
        const read = new Map()
        for (const e of prof.reads) { const s = slugOf(e.path); if (bySlug.has(s) && !read.has(s)) read.set(s, e) }
        const order = [...prof.on, ...read.keys(), ...prof.seeds].filter((s, i, all) => bySlug.has(s) && all.indexOf(s) === i && !prof.off.includes(s)).slice(0, 48)
        const topics = Object.keys(prof.topics).filter(t => prof.topics[t] > 0).sort((a, b) => prof.topics[b] - prof.topics[a])
        if (!topics.length || !order.length) {
            this._set(h('p', { class: 'dim graph-empty' }, 'Nothing to draw yet. Read a page, or keep one, and the graph starts here: you in the middle, the topics you read around you, and the pages behind them.'))
            return
        }
        const W = 760, H = 560, cx = W / 2, cy = H / 2, R1 = 145, R2 = 238
        const max = prof.topics[topics[0]]
        // each page hangs off the topic this persona weights most among its own
        const groups = {}
        for (const s of order) {
            const a = bySlug.get(s)
            const t = (a.topics || []).filter(x => prof.topics[x] > 0).sort((x, y) => prof.topics[y] - prof.topics[x])[0] || topics[0]
            ;(groups[t] = groups[t] || []).push(s)
        }
        // each topic gets an arc in proportion to the pages it carries, so a persona with one
        // strong topic fans out instead of crowding into a sixth of the circle
        const share = t => (groups[t] || []).length + 2
        const whole = topics.reduce((n, t) => n + share(t), 0)
        const tpos = {}
        let at = -Math.PI / 2
        for (const t of topics) {
            const span = 2 * Math.PI * share(t) / whole
            const ang = at + span / 2
            at += span
            tpos[t] = { ang, span, x: cx + R1 * Math.cos(ang), y: cy + R1 * Math.sin(ang), r: 9 + 17 * Math.sqrt(Math.max(prof.topics[t], 0) / max) }
        }
        const apos = {}
        for (const [t, list] of Object.entries(groups)) {
            list.forEach((s, i) => {
                const f = list.length === 1 ? 0 : (i / (list.length - 1) - 0.5)
                const ang = tpos[t].ang + f * tpos[t].span * 0.8
                const r = R2 + (i % 2 ? 22 : -8)
                apos[s] = { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), t }
            })
        }
        const el = (tag, attrs, ...kids) => {
            const n = document.createElementNS(SVG, tag)
            for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v)
            for (const k of kids) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)))
            return n
        }
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'graph', role: 'img', 'aria-label': `A graph of ${order.length} pages across ${topics.length} topics` })
        const links = el('g', { class: 'links' })
        let nLinks = 0
        for (const s of order) {
            for (const o of bySlug.get(s).links_out || []) {
                if (apos[o] && s < o || (apos[o] && !(bySlug.get(o).links_out || []).includes(s))) {
                    const mx = (apos[s].x + apos[o].x) / 2, my = (apos[s].y + apos[o].y) / 2
                    links.append(el('path', { d: `M${apos[s].x},${apos[s].y} Q${(mx + cx) / 2},${(my + cy) / 2} ${apos[o].x},${apos[o].y}`, class: 'cite' }))
                    nLinks++
                }
            }
        }
        const spokes = el('g', {})
        for (const t of topics) spokes.append(el('line', { x1: cx, y1: cy, x2: tpos[t].x, y2: tpos[t].y, class: 'spoke' }))
        for (const s of order) spokes.append(el('line', { x1: tpos[apos[s].t].x, y1: tpos[apos[s].t].y, x2: apos[s].x, y2: apos[s].y, class: 'stem' }))
        svg.append(links, spokes)
        for (const t of topics) {
            const p = tpos[t]
            const right = Math.cos(p.ang) >= -0.01
            svg.append(el('g', { class: 'topic-node' },
                el('circle', { cx: p.x, cy: p.y, r: p.r }),
                el('text', { x: p.x + (right ? p.r + 6 : -p.r - 6), y: p.y + 4, 'text-anchor': right ? 'start' : 'end' }, meter.topicLabel(feed, t))))
        }
        for (const s of order) {
            const a = bySlug.get(s), e = read.get(s)
            const cls = prof.on.includes(s) ? 'kept' : e ? (e.declined ? 'declined' : 'read') : 'seed'
            const why = cls === 'kept' ? 'kept' : cls === 'read' ? `read ${Math.round((e.depth == null ? 1 : e.depth) * 100)}%` : cls === 'declined' ? `declined: ${e.declined.reason}` : 'from the preset, not read yet'
            svg.append(el('a', { href: this._root + meter.cfg.picks.base + s + '.html' },
                el('circle', { cx: apos[s].x, cy: apos[s].y, r: cls === 'kept' ? 6.5 : 5, class: `art ${cls}` },
                    el('title', {}, `${a.title} (${why})`))))
        }
        const p = prof.persona
        svg.append(el('g', { class: 'me-node', style: meter.personaTheme(p) ? `--pc:${meter.personaTheme(p)}` : null },
            el('circle', { cx, cy, r: 30 }),
            el('text', { x: cx, y: cy + 5, 'text-anchor': 'middle' }, p.id === 'me' ? 'you' : (meter.personaName(p, prof).split(/[ ,]/)[0] || 'persona').slice(0, 9))))
        const kept = order.filter(s => prof.on.includes(s)).length
        this._set(svg, h('p', { class: 'legend' },
            h('span', {}, h('i', { class: 'k read' }), `${[...read.keys()].filter(s => order.includes(s)).length} read`),
            h('span', {}, h('i', { class: 'k kept' }), `${kept} kept`),
            prof.seeds.length ? h('span', {}, h('i', { class: 'k seed' }), 'from the preset') : null,
            h('span', {}, `${topics.length} topics`),
            h('span', {}, `${nLinks} citations between these pages`),
            h('span', { class: 'dim' }, 'Hover or tap a dot for the page; tap through to open it.')))
    }

    async _link() {
        const feed = await meter.feed()
        const prof = meter.profile(feed)
        const name = meter.personaName(prof.persona, prof)
        const n = feed ? meter.picks(feed, 9).length : 0
        this._set(h('a', { class: 'golink', href: this._root + meter.cfg.links2.newsroom },
            h('span', { class: 'k' }, 'Your newsroom'),
            prof.total > 0 ? h('span', {}, 'Picked for ', h('b', {}, name), n ? `: ${n} unread` : '', ' →')
                           : h('span', {}, 'Choose a persona, or just read, and it builds itself →')))
    }

    // ------------------------------------------------------------ sharing (v1.2)
    async _share() {
        if (this._sent) return
        const feed = await meter.feed()
        const who  = this._who || { name: '', email: '', note: '', subscribe: false }
        this._who = who
        const data = meter.shareData(feed, who)
        const last = (meter.state.shares || [])[0]
        const box  = h('textarea', { class: 'preview', readonly: true, rows: '12', 'aria-label': 'Exactly what would be shared' })
        box.value = data.text
        const status = h('p', { class: 'dim status', role: 'status' }, this._status || '')
        const copy = async () => {
            let ok = false
            try { await navigator.clipboard.writeText(data.text); ok = true } catch (e) { box.select(); try { ok = document.execCommand('copy') } catch (e2) { ok = false } }
            this._status = ok ? `Copied: ${data.pages} pages. Paste it into an email or a message to us.` : 'This browser would not copy. The text is selected: copy it with your keyboard.'
            if (ok) meter.noteShared('copied', data.pages)
            else this._paint()
        }
        const input = (name, attrs) => {
            const el = h('input', { name, ...attrs, value: who[name] || '' })
            el.addEventListener('input', () => { who[name] = el.value; box.value = meter.shareData(feed, who).text })
            return el
        }
        const sub = h('input', { type: 'checkbox', name: 'subscribe' })
        sub.checked = !!who.subscribe
        sub.addEventListener('change', () => { who.subscribe = sub.checked })
        const consent = h('input', { type: 'checkbox', name: 'consent' })
        const trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'trap', 'aria-hidden': 'true' })
        const form = h('form', { class: 'share-form', onsubmit: ev => { ev.preventDefault(); this._send(feed, consent, trap, status) } },
            h('label', {}, 'Your name', input('name', { type: 'text', autocomplete: 'name', maxlength: '80' })),
            h('label', {}, 'Your email, so we can send you the result', input('email', { type: 'email', autocomplete: 'email', maxlength: '120', required: true })),
            h('label', { class: 'wide' }, 'Anything you want us to know (optional)', input('note', { type: 'text', maxlength: '300' })),
            h('label', { class: 'check wide' }, consent, ' You may keep this reading data with my name and email, and email me about it.'),
            h('label', { class: 'check wide' }, sub, ' Also send me the SGit Newsroom newsletter.'),
            trap,
            h('div', { class: 'actions wide' }, h('button', { type: 'submit', class: 'btn primary' }, 'Send it, encrypted'),
              h('button', { type: 'button', class: 'btn', onclick: copy }, 'Copy it instead')))
        this._set(
            h('div', { class: 'card share-sum' },
                h('div', {},
                    h('span', { class: 'dim' }, 'What you would be sharing'),
                    h('b', { class: 'big' }, `${data.pages} page${data.pages === 1 ? '' : 's'}`),
                    h('span', { class: 'dim' }, `${data.json.personas.length} persona${data.json.personas.length === 1 ? '' : 's'} · ${data.json.topics.length} topics · how far you read each page, what you kept, put out and declined`),
                    last ? h('span', { class: 'dim' }, `Last shared ${last.at.slice(0, 10)} (${last.how}, ${last.pages} pages)`) : null),
                h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: copy }, 'Copy to clipboard'))),
            data.pages < 5 ? h('p', { class: 'warn' }, `Only ${data.pages} page${data.pages === 1 ? '' : 's'} so far. It is more useful after a few days of reading as you normally would.`) : null,
            h('h2', { class: 'sect' }, 'Send it to us'), form, status,
            h('h2', { class: 'sect' }, 'Exactly what is shared'),
            h('p', { class: 'dim' }, 'This is the whole of it, as it would arrive: a summary you can read, then the same data for a computer. No payment references, no IP address, nothing from other sites. It changes as you type your name.'),
            box)
    }

    async _send(feed, consent, trap, status) {
        const who = this._who
        const say = (t, cls) => { status.textContent = t; status.className = `status ${cls || 'dim'}` }
        if (trap.value) { say('Sent.', 'dim'); return }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(who.email || '')) { say('Please give an email address we can reply to.', 'warn'); return }
        if (!consent.checked) { say('Please tick the box: it is your permission to keep this and email you about it.', 'warn'); return }
        const cfg = meter.cfg.share
        const data = meter.shareData(feed, who)
        try {
            if (!cfg.contact) throw new Error('This site has not set up a place to send it.')
            if (!window.crypto || !crypto.subtle) throw new Error('This browser cannot encrypt here.')
            say('Fetching the key and encrypting…')
            const r = await fetch(meter.cfg.root + cfg.contact, { cache: 'no-store' })
            if (!r.ok) throw new Error(`The contact file did not load (${r.status}).`)
            const file = await r.json()
            const inbox = file.inbox, lane = inbox && inbox.lane
            if (!file.recipient || !lane || inbox.status !== 'open') throw new Error('The inbox is not open.')
            const fp = await fingerprint(file.recipient.encrypt)
            if (fp !== file.recipient.fingerprint || fp !== inbox.encrypt_to) throw new Error('The key in the contact file does not match its fingerprint.')
            const id = `sgit-share-${Date.now()}-${Math.random().toString(16).slice(2, 10)}@${location.host || 'site'}`
            const to = cfg.to || file.recipient.address
            const eml = [
                `From: web form <site@${location.host || 'site'}>`, `To: ${to}`,
                `Subject: Reading share: ${oneLine(who.name) || oneLine(who.email)}`,
                `Date: ${new Date().toUTCString()}`, `Message-ID: <${id}>`,
                'X-EmailFS-Kind: notification', `X-SGit-Form: ${cfg.form}`,
                `X-SGit-Reply-To: ${oneLine(who.email)}`, `X-SGit-Name: ${oneLine(who.name)}`,
                `X-SGit-Subscribe: ${who.subscribe ? 'yes' : 'no'}`, `X-SGit-Page: ${oneLine(location.pathname)}`,
                'Content-Type: text/plain; charset=utf-8',
            ].join('\r\n') + '\r\n\r\n' + (data.text
                + '\n\nConsent: yes, keep this reading data with my name and email, and email me about it'
                + `\nNewsletter: ${who.subscribe ? 'yes, also send me the newsletter' : 'no'}`
                + `\nSent from: ${location.href}\n`).replace(/\r?\n/g, '\r\n')
            const payload = await envelope(file.recipient.encrypt, eml)
            say(`Encrypted to ${fp}. Sending…`)
            const w = await fetch(`${inbox.endpoint}/api/vault/append/write/${inbox.vault}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ append_token: lane.append_token, payload }) })
            let j = null
            try { j = await w.json() } catch (e) { j = null }
            if (!w.ok || !j || j.ok !== true) throw new Error(`The vault host answered ${w.status}.`)
            this._sent = true
            meter.noteShared('sent', data.pages)
            this._set(h('div', { class: 'card' },
                h('div', {}, h('span', { class: 'dim' }, 'Sent, encrypted'), h('b', { class: 'big' }, 'Thank you'),
                  h('span', {}, `${data.pages} pages, encrypted in this browser to ${fp}, so only the agent that holds that key can read it. We will reply to ${who.email} with what your front page could look like.`)),
                h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: this._root + meter.cfg.links2.newsroom }, 'Back to your newsroom'))))
        } catch (err) {
            const why = /failed to fetch|networkerror|load failed/i.test(String(err && err.message)) ? 'The vault host could not be reached.' : String(err && err.message || err)
            say(`${why.replace(/\.?$/, '.')} Nothing was sent. Use "Copy it instead" and paste it into an email to us.`, 'warn')
        }
    }

    _export() {
        const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(meter.state, null, 2)], { type: 'application/json' })), download: 'reading-account.json' })
        document.body.append(a)
        a.click()
        a.remove()
    }

    // ------------------------------------------------------------ top-up
    _topup() {
        const t = meter.cfg.topup
        if (t.link) {
            this._set(h('div', { class: 'card' },
                h('div', {}, h('b', {}, `Top up ${meter.money(t.amount)}`),
                  h('span', { class: 'dim' }, `Paid on the payment provider's page. You come back to a page that adds ${meter.money(t.amount)} to the balance in this browser, which becomes ${meter.money(meter.state.balance + t.amount)}.`)),
                h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: t.link }, `Pay ${meter.money(t.amount)}`))))
            return
        }
        this._cartStep = this._cartStep || 'cart'
        const s = meter.state
        const pack = id => meter.cfg.packs.find(p => p.id === id)
        const total = s.cart.reduce((a, l) => { const p = pack(l.id); return p ? { price: a.price + p.price * l.qty, credit: a.credit + (p.price + p.bonus) * l.qty } : a }, { price: 0, credit: 0 })
        if (this._cartStep === 'done') {
            this._set(h('div', { class: 'card' },
                h('div', {}, h('span', { class: 'dim' }, `Receipt ${this._receipt}`), h('b', { class: 'big' }, `${meter.money(this._credited)} added`),
                  h('span', { class: 'dim' }, `New balance ${meter.money(s.balance)}. Simulated: nothing was charged.`)),
                h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: this._root + meter.cfg.links.account }, 'Your account'))))
            return
        }
        const save = () => { meter.save() }
        const kids = [
            h('p', { class: 'warn' }, 'No payment link is configured, so this is the simulated cart: every step but the payment.'),
            h('div', { class: 'packs' }, meter.cfg.packs.map(p => h('div', { class: 'pack' },
                h('b', {}, meter.money(p.price)),
                h('span', {}, `${meter.money(p.price + p.bonus)} of credit${p.bonus ? `, ${meter.money(p.bonus)} extra` : ''}`),
                h('button', { type: 'button', class: 'btn', onclick: () => {
                    const l = s.cart.find(x => x.id === p.id)
                    if (l) l.qty += 1
                    else s.cart.push({ id: p.id, qty: 1 })
                    this._cartStep = 'cart'
                    save()
                } }, 'Add to cart')))),
            h('h2', { id: 'cart' }, 'Cart'),
        ]
        if (!s.cart.length) kids.push(h('p', { class: 'dim' }, 'Empty.'))
        else {
            kids.push(h('div', { class: 'tablewrap' }, h('table', {},
                h('tr', {}, ['Pack', 'Qty', 'Credit', 'Price'].map(x => h('th', {}, x))),
                s.cart.map((l, i) => { const p = pack(l.id); return h('tr', {},
                    h('td', {}, meter.money(p.price)),
                    h('td', {}, h('button', { type: 'button', class: 'q', 'aria-label': 'One fewer', onclick: () => { l.qty -= 1; if (l.qty <= 0) s.cart.splice(i, 1); save() } }, '−'),
                      ` ${l.qty} `, h('button', { type: 'button', class: 'q', 'aria-label': 'One more', onclick: () => { l.qty += 1; save() } }, '+')),
                    h('td', {}, meter.money((p.price + p.bonus) * l.qty)), h('td', {}, meter.money(p.price * l.qty))) }),
                h('tr', {}, h('th', {}, 'Total'), h('th', {}), h('th', {}, meter.money(total.credit)), h('th', {}, meter.money(total.price))))))
            kids.push(this._cartStep === 'cart'
                ? h('p', {}, h('button', { type: 'button', class: 'btn primary', onclick: () => { this._cartStep = 'review'; this._topup() } }, 'Checkout →'))
                : h('div', { class: 'card' },
                    h('div', {}, h('b', {}, 'Review'), h('span', {}, `${meter.money(total.credit)} of credit for ${meter.money(total.price)}.`), h('span', { class: 'dim' }, 'Payment: simulated.')),
                    h('div', { class: 'actions' },
                        h('button', { type: 'button', class: 'btn primary', onclick: () => {
                            this._receipt  = `SIM-${Date.now().toString(36).toUpperCase()}`
                            this._credited = total.credit
                            this._cartStep = 'done'
                            s.cart = []
                            meter.credit(total.credit, 'simulated', this._receipt)
                        } }, 'Confirm (simulated)'),
                        h('button', { type: 'button', class: 'btn', onclick: () => { this._cartStep = 'cart'; this._topup() } }, 'Back'))))
        }
        this._set(...kids)
    }

    // ------------------------------------------------------------ the page a payment link returns to
    // DELIBERATELY UNPROTECTED and documented: a static page cannot verify a payment, so opening
    // it with a session id adds the top-up once per id. The default route is the payment link;
    // building this URL by hand gives credit on the reader's own screen and costs the site nothing.
    _toppedUp() {
        const m  = location.search.match(/[?&]session_id=([^&]+)/)
        const id = m ? decodeURIComponent(m[1]).slice(0, 120) : ''
        const t  = meter.cfg.topup
        if (!id) {
            this._set(h('p', {}, 'This is the page a top-up returns to. It needs the reference the payment page sends back, and there is none here.'))
            return
        }
        const added = meter.credit(t.amount, 'link', id)
        this._set(h('div', { class: 'card' },
            h('div', {},
                h('span', { class: 'dim' }, added ? 'Thank you' : 'Already added'),
                h('b', { class: 'big' }, added ? `${meter.money(t.amount)} added` : 'Nothing more to add'),
                h('span', { class: 'dim' }, added ? `Your balance in this browser is now ${meter.money(meter.state.balance)}. The receipt from the payment page is in your email.`
                                                  : `This top-up was added to this browser before. Balance ${meter.money(meter.state.balance)}.`)),
            h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: this._root + meter.cfg.links.account }, 'Your account'))))
    }
}

customElements.define('sg-meter', SgMeter)
