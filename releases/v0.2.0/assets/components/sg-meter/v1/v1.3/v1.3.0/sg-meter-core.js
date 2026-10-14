/**
 * sg-meter-core — the reading meter's state and rules, with no rendering.
 *
 * One instance per page (an ES module is evaluated once), shared by every <sg-meter> element on
 * it, so a page with a balance in the nav, a cost line at the foot and an account panel is still
 * charged once. Everything is kept in the reader's localStorage. Nothing is sent anywhere.
 *
 * THE RULES, each written down because each is a decision:
 *   - A page is charged for the share of it the reader scrolled through: its price times the
 *     deepest point reached (never less than minDepth, so opening a page is not free).
 *   - One charge per page per browser session; scrolling further later in the session tops the
 *     same charge up, it never starts a second one.
 *   - Credit can go below zero. Nothing is blocked and nothing nags; the balance is shown.
 *   - A reader can decline to pay for a page, with a reason; the charge is refunded and the
 *     reason kept as a signal ("not relevant" counts against that page's topics in the picks).
 *   - Storage is allowed to fail. The page keeps working and the meter says it cannot keep a
 *     balance.
 *
 * PERSONAS (v1.1). A reader has one or more personas and one is active. "me" always exists and
 * is built from everything they read; others start from a preset the site offers (a few topics
 * and articles) or from nothing, and grow from what is read while they are active. Any article
 * can be kept in a persona or put out of it, which moves its topics and tags up or down. A
 * persona is a way to manage focus: the same reader is a different reader at work and at home.
 * Everything about a persona is in the same local state as the balance, and goes where it goes.
 *
 * Configuration: <script type="application/json" id="sg-meter-config">{...}</script> on the page,
 * or window.SG_METER_CONFIG. Every key has a default (DEFAULTS below).
 *
 * Events, on document: sg:meter.charged, sg:meter.declined, sg:meter.toppedup, sg:meter.reset,
 * sg:meter.persona (the active persona changed, or one was added, curated, renamed or removed),
 * sg:meter.restored, sg:meter.shared (v1.2: the reader sent their reading to the site),
 * sg:meter.changed (any state change; the elements repaint on it).
 *
 * RATINGS (v1.3). At the foot of a page the reader can move three five-step scales, each starting
 * in the middle: how useful it was (which sets the price: 1 is free, 3 the price, 5 double), more
 * like this or less (which moves the page's topics and tags in the active persona), and the
 * level of detail they want (kept as a preference). Not paying at all, with a reason, is still
 * there, but it is the last resort, not the first thing offered. An article opened for the first
 * time joins the active persona's reading list unless the reader put it out of that persona.
 *
 * SHARING (v1.2). Nothing leaves the browser unless the reader chooses to send it. shareData()
 * builds the exact text the reader sees, copies or sends: a summary a person can read and the
 * same data as compact JSON. Payment references are never in it.
 *
 * @module sg-meter-core
 * @version 1.3.0
 */

export const DEFAULTS = Object.freeze({
    storageKey : 'sg.meter.v1',
    start      : 500,                       // starting credit, in pence (or cents)
    newDays    : 7,                         // an article younger than this is "new"
    symbol     : '£',
    prices     : { article_new: 10, article: 5, issue: 3, note: 2, collection: 2, page: 1, free: 0 },
    depth      : true,                      // charge by scroll depth
    minDepth   : 0.1,
    topup      : { amount: 500, link: '' }, // a payment link (e.g. Stripe); empty means simulated
    packs      : [{ id: 'p5', price: 500, bonus: 0 }],
    links      : { account: 'account/index.html', topup: 'account/top-up.html' },
    picks      : { feed: '', base: '' },    // a JSON feed of {articles:[{slug,title,date,teaser,topics,tags}], topics:[{id,label}]}
    links2     : { newsroom: 'account/newsroom.html', personas: 'account/personas.html' },
    personas   : { presets: [], names: {} },
    rating     : { price: [0, 0.5, 1, 1.5, 2], more: [-3, -1, 0, 3, 6] },  // what each step 1..5 does
    autoKeep   : true,                      // an article opened for the first time joins the persona's reading list
    share      : { contact: '', form: 'reading-share', to: '', site: '', max: 300 },  // contact: a sgit-subscribe/v1 file with a public key and an append lane// presets: [{id,label,name,theme,blurb,topics:{id:w},articles:[slug]}]; names: {topicId:'The …'}
    root       : '',
})

export const REASONS = Object.freeze([
    ['clickbait',    'The headline promised more than the page gave'],
    ['not-relevant', 'Not relevant to me'],
    ['did-not-read', 'I did not really read it'],
    ['other',        'Another reason'],
])

const LOG_MAX = 500

function _config() {
    let cfg = {}
    try {
        const el = document.getElementById('sg-meter-config')
        if (el) cfg = JSON.parse(el.textContent)
        else if (window.SG_METER_CONFIG) cfg = window.SG_METER_CONFIG
    } catch (e) { cfg = {} }
    const out = { ...DEFAULTS, ...cfg }
    out.prices = { ...DEFAULTS.prices, ...(cfg.prices || {}) }
    out.topup  = { ...DEFAULTS.topup, ...(cfg.topup || {}) }
    out.links  = { ...DEFAULTS.links, ...(cfg.links || {}) }
    out.picks  = { ...DEFAULTS.picks, ...(cfg.picks || {}) }
    out.links2 = { ...DEFAULTS.links2, ...(cfg.links2 || {}) }
    out.personas = { ...DEFAULTS.personas, ...(cfg.personas || {}) }
    out.share  = { ...DEFAULTS.share, ...(cfg.share || {}) }
    out.rating = { ...DEFAULTS.rating, ...(cfg.rating || {}) }
    if (!out.root) out.root = document.documentElement.getAttribute('data-root') || ''
    return out
}

export const r1 = x => Math.round(x * 10) / 10

class Meter {

    constructor() {
        this.cfg       = _config()
        this.noStorage = false
        this.state     = this._read()
        this.entry     = null
        this.status    = 'idle'           // idle | free | paused | reading | declined
        this.price     = 0
        this._feed     = null
    }

    // ------------------------------------------------------------ text
    money(p) {
        const neg = p < -0.004
        return `${neg ? '−' : ''}${this.cfg.symbol}${(Math.abs(p) / 100).toFixed(2)}`
    }

    pence(p) {
        p = r1(p)
        if (p === 0) return 'nothing'
        return `${p % 1 ? p.toFixed(1) : p}p`
    }

    // ------------------------------------------------------------ storage, which is allowed to fail
    _fresh() {
        return { v: 3, created: new Date().toISOString(), balance: this.cfg.start, spent: 0, reads: 0, declined: 0,
                 paused: false, log: [], topups: [], cart: [], sessions: [],
                 active: 'me', personas: [{ id: 'me', name: '', created: new Date().toISOString(), on: [], off: [] }] }
    }

    _read() {
        try {
            const raw = localStorage.getItem(this.cfg.storageKey)
            if (!raw) return this._fresh()
            const s = { ...this._fresh(), ...JSON.parse(raw) }
            if (s.waived && !s.declined) s.declined = s.waived       // v1 name
            if (!Array.isArray(s.personas) || !s.personas.find(p => p.id === 'me'))
                s.personas = [{ id: 'me', name: '', created: s.created, on: [], off: [] }, ...(Array.isArray(s.personas) ? s.personas : [])]
            if (!s.personas.find(p => p.id === s.active)) s.active = 'me'
            s.v = 3
            return s
        } catch (e) {
            this.noStorage = true
            return this._fresh()
        }
    }

    save() {
        try { localStorage.setItem(this.cfg.storageKey, JSON.stringify(this.state)) }
        catch (e) { this.noStorage = true }
        this._emit('changed', { balance: this.state.balance })
    }

    _emit(what, detail) {
        document.dispatchEvent(new CustomEvent(`sg:meter.${what}`, { detail, bubbles: true, composed: true }))
    }

    // ------------------------------------------------------------ prices
    priceOf(meta) {
        const p = this.cfg.prices
        if (meta.kind === 'article') {
            const age = meta.date ? Math.floor((Date.now() - Date.parse(`${meta.date}T00:00:00Z`)) / 86400000) : 9999
            return age <= this.cfg.newDays ? p.article_new : p.article
        }
        return p[meta.kind] != null ? p[meta.kind] : p.page
    }

    // ------------------------------------------------------------ the charge
    _seen() {
        try { return JSON.parse(sessionStorage.getItem(`${this.cfg.storageKey}.seen`) || '{}') }
        catch (e) { return {} }
    }

    _setSeen(m) {
        try { sessionStorage.setItem(`${this.cfg.storageKey}.seen`, JSON.stringify(m)) }
        catch (e) { /* the charge still happens; only the once-per-session guard is lost */ }
    }

    /** Open this page: called once by the page element. Idempotent. */
    open(meta) {
        if (this.status !== 'idle') return
        this.meta  = meta
        this.price = this.priceOf(meta)
        if (this.price === 0)    { this.status = 'free'; return }
        if (this.state.paused)   { this.status = 'paused'; return }
        const path = location.pathname.replace(/index\.html$/, '') || '/'
        const seen = this._seen()
        const prev = seen[path] && this.state.log.find(e => e.id === seen[path])
        if (prev) {
            this.entry  = prev
            this.status = prev.declined ? 'declined' : 'reading'
            return
        }
        this.entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
                       path, title: meta.title, kind: meta.kind, topics: meta.topics, price: this.price, depth: 0, cost: 0,
                       persona: this.state.active }
        this.state.log.unshift(this.entry)
        this.state.log = this.state.log.slice(0, LOG_MAX)
        this.state.reads += 1
        seen[path] = this.entry.id
        this._setSeen(seen)
        this.status = 'reading'
        const slug = Meter.slugOf(path)
        const p = this.persona()
        if (this.cfg.autoKeep && meta.kind === 'article' && !p.off.includes(slug) && !p.on.includes(slug)
                && !this.state.log.slice(1).some(x => Meter.slugOf(x.path) === slug)) {
            p.on.unshift(slug)
            this.entry.autoKept = true
        }
    }

    /** Grow the charge to the given depth (0..1). Only ever grows. */
    reach(depth) {
        const e = this.entry
        if (!e || this.status !== 'reading') return
        const d = this.cfg.depth ? Math.round(Math.max(0, Math.min(1, depth)) * 20) / 20 : 1
        if (d <= e.depth && (e.cost > 0 || e.rating)) return
        e.depth = Math.max(d, e.depth)
        const cost  = this._costOf(e)
        const delta = r1(cost - e.cost)
        e.cost  = cost
        this.state.balance = r1(this.state.balance - delta)
        this.state.spent   = r1(this.state.spent + delta)
        this.save()
        this._emit('charged', { path: e.path, depth: e.depth, cost, balance: this.state.balance })
    }

    /** The charge for an entry: its price, times the share read, times what the reader's usefulness rating says. */
    _costOf(e) {
        const q = e.rating && e.rating.useful ? this.cfg.rating.price[e.rating.useful - 1] : 1
        return r1(e.price * Math.max(this.cfg.depth ? e.depth : 1, this.cfg.minDepth) * (q == null ? 1 : q))
    }

    /** Rate this page on one of 'useful', 'more', 'detail', from 1 to 5. A usefulness rating re-prices it. */
    rate(field, value) {
        const e = this.entry
        if (!e || e.declined || !['useful', 'more', 'detail'].includes(field)) return
        const v = Math.max(1, Math.min(5, Math.round(Number(value))))
        e.rating = { ...(e.rating || {}), [field]: v, at: new Date().toISOString() }
        const cost  = this._costOf(e)
        const delta = r1(cost - e.cost)
        e.cost = cost
        this.state.balance = r1(this.state.balance - delta)
        this.state.spent   = r1(this.state.spent + delta)
        this.save()
        this._emit('rated', { path: e.path, field, value: v, cost, balance: this.state.balance })
    }

    /** Decline to pay for this page, with one of REASONS. Refunds the charge. */
    decline(reason) {
        const e = this.entry
        if (!e || e.declined) return
        this.state.balance  = r1(this.state.balance + e.cost)
        this.state.spent    = r1(this.state.spent - e.cost)
        this.state.declined = r1(this.state.declined + e.cost)
        e.declined = { reason, at: new Date().toISOString(), refunded: e.cost }
        e.cost     = 0
        this.status = 'declined'
        this.save()
        this._emit('declined', { path: e.path, reason, balance: this.state.balance })
    }

    // ------------------------------------------------------------ account actions
    togglePause() { this.state.paused = !this.state.paused; this.save() }

    reset() {
        this.state = this._fresh()
        try { sessionStorage.removeItem(`${this.cfg.storageKey}.seen`) } catch (e) { /* ok */ }
        this.save()
        this._emit('reset', {})
    }

    /** Add credit. source: 'simulated' | 'link'. ref: a receipt reference (the session id, for a link). */
    credit(amount, source, ref) {
        if (source === 'link') {
            if (this.state.sessions.includes(ref)) return false
            this.state.sessions.push(ref)
        }
        this.state.balance = r1(this.state.balance + amount)
        this.state.topups.unshift({ ref: String(ref).slice(0, 40), at: new Date().toISOString(), credit: amount, source })
        this.save()
        this._emit('toppedup', { credit: amount, source, balance: this.state.balance })
        return true
    }

    /** Replace the whole state with one exported earlier. Returns an error string, or '' on success. */
    restore(text) {
        let s
        try { s = JSON.parse(text) } catch (e) { return 'That file is not JSON.' }
        if (!s || typeof s.balance !== 'number' || !Array.isArray(s.log)) return 'That file is not a reading account export.'
        const keep = this.state
        this.state = { ...this._fresh(), ...s }
        try { localStorage.setItem(this.cfg.storageKey, JSON.stringify(this.state)) } catch (e) { this.noStorage = true }
        this.state = this._read()
        if (this.noStorage) this.state = keep
        this.save()
        this._emit('restored', { reads: this.state.reads })
        return ''
    }

    // ------------------------------------------------------------ personas
    persona(id) { return this.state.personas.find(p => p.id === (id || this.state.active)) || this.state.personas[0] }

    preset(id) { return (this.cfg.personas.presets || []).find(p => p.id === id) }

    /** What a persona is called: the reader's name for it, else the preset's, else one made from its topics. */
    personaName(p, prof) {
        if (p.name) return p.name
        const pre = p.preset && this.preset(p.preset)
        if (pre) return this.presetName(pre)
        const names = this.cfg.personas.names || {}
        const top = prof ? Object.keys(prof.topics).filter(t => prof.topics[t] > 0).sort((a, b) => prof.topics[b] - prof.topics[a]) : []
        if (!top.length) return p.id === 'me' ? 'You, so far' : 'A new persona'
        const first = names[top[0]] || top[0]
        return top[1] && names[top[1]] ? `${first}, with a streak of ${names[top[1]].replace(/^The /, 'the ')}` : first
    }

    /** "Kai, the AI builder": the preset's name and its label, with only the label's first letter lowered. */
    presetName(pre) { return `${pre.name}, ${pre.label.charAt(0).toLowerCase()}${pre.label.slice(1)}` }

    personaTheme(p) {
        const pre = p.preset && this.preset(p.preset)
        return p.theme || (pre && pre.theme) || ''
    }

    _personaChanged(what) { this.save(); this._emit('persona', { active: this.state.active, what }) }

    setActive(id) { if (this.state.personas.find(p => p.id === id)) { this.state.active = id; this._personaChanged('active') } }

    addPersona(presetId) {
        const pre = presetId && this.preset(presetId)
        if (pre && this.state.personas.find(p => p.preset === pre.id)) { this.setActive(this.state.personas.find(p => p.preset === pre.id).id); return }
        const id = (pre ? pre.id : 'p') + '-' + Date.now().toString(36)
        this.state.personas.push({ id, preset: pre ? pre.id : '', name: '', created: new Date().toISOString(), on: [], off: [] })
        this.state.active = id
        this._personaChanged('added')
    }

    renamePersona(id, name) { const p = this.persona(id); p.name = String(name || '').slice(0, 60).trim(); this._personaChanged('renamed') }

    removePersona(id) {
        if (id === 'me') return
        this.state.personas = this.state.personas.filter(p => p.id !== id)
        if (this.state.active === id) this.state.active = 'me'
        this._personaChanged('removed')
    }

    /** Keep an article in a persona ('on'), put it out ('off'), or neither (''). */
    curate(slug, how, id) {
        const p = this.persona(id)
        p.on  = p.on.filter(s => s !== slug)
        p.off = p.off.filter(s => s !== slug)
        if (how === 'on') p.on.unshift(slug)
        if (how === 'off') p.off.unshift(slug)
        this._personaChanged('curated')
    }

    curation(slug, id) { const p = this.persona(id); return p.on.includes(slug) ? 'on' : p.off.includes(slug) ? 'off' : '' }

    static slugOf(path) { return String(path || '').replace(/^.*\//, '').replace(/\.html$/, '') }

    /**
     * A persona's interests, as weights on topics and tags.
     *   reads    what was read while it was active ("me": everything), weighted by what was paid
     *   seeds    a preset's topics and articles
     *   on/off   the reader's curation: +5 / -3 on each of an article's topics and tags
     * A page declined as "not relevant" counts -2 on its topics, as in v1.0.
     */
    profile(feed, id) {
        const p = this.persona(id)
        const bySlug = new Map(((feed && feed.articles) || []).map(a => [a.slug, a]))
        const topics = {}, tags = {}
        let total = 0, detailSum = 0, detailN = 0
        const add = (a, wt, wg) => {
            for (const t of a.topics || []) topics[t] = (topics[t] || 0) + wt
            for (const t of a.tags || []) tags[t] = (tags[t] || 0) + wg
        }
        const reads = this.state.log.filter(e => p.id === 'me' || e.persona === p.id)
        for (const e of reads) {
            const v = e.declined ? (e.declined.reason === 'not-relevant' ? -2 : 0) : e.cost
            const a = bySlug.get(Meter.slugOf(e.path))
            for (const t of (a ? a.topics : e.topics) || []) topics[t] = (topics[t] || 0) + v
            if (a) for (const t of a.tags || []) tags[t] = (tags[t] || 0) + v / 2
            total += Math.max(v, 0)
            const m = e.rating && e.rating.more ? this.cfg.rating.more[e.rating.more - 1] : 0
            if (m) {
                for (const t of (a ? a.topics : e.topics) || []) topics[t] = (topics[t] || 0) + m
                if (a) for (const t of a.tags || []) tags[t] = (tags[t] || 0) + m
            }
            if (e.rating && e.rating.detail) { detailSum += e.rating.detail - 3; detailN++ }
        }
        const pre = p.preset && this.preset(p.preset)
        if (pre) {
            for (const [t, w] of Object.entries(pre.topics || {})) { topics[t] = (topics[t] || 0) + w * 10; total += w * 10 }
            for (const s of pre.articles || []) { const a = bySlug.get(s); if (a) add(a, 3, 3) }
        }
        for (const s of p.on)  { const a = bySlug.get(s); if (a) { add(a, 5, 5); total += 5 } }
        for (const s of p.off) { const a = bySlug.get(s); if (a) add(a, -3, -3) }
        return { persona: p, topics, tags, total, reads,
                 // the level of detail this persona asks for: -2 (much less) .. +2 (much more technical)
                 detail: detailN ? Math.round(10 * detailSum / detailN) / 10 : 0, rated: detailN,
                 seeds: pre ? (pre.articles || []) : [], on: p.on, off: p.off,
                 // v1.0 callers read .weights
                 weights: topics }
    }

    // ------------------------------------------------------------ sharing (v1.2)
    /**
     * What a reader would send: a readable summary and the same data as JSON. The log is cut to
     * share.max entries, newest first, one row each: [when, page, kind, depth, cost, declined, persona].
     */
    shareData(feed, who) {
        const s = this.state
        const label = id => this.topicLabel(feed, id)
        const me = this.profile(feed, 'me')
        const topics = Object.keys(me.topics).filter(t => me.topics[t] > 0).sort((a, b) => me.topics[b] - me.topics[a])
        const sum = topics.reduce((n, t) => n + me.topics[t], 0) || 1
        const personas = s.personas.map(p => {
            const prof = this.profile(feed, p.id)
            return { id: p.id, preset: p.preset || '', name: this.personaName(p, prof), reads: prof.reads.length, on: p.on, off: p.off }
        })
        const rows = s.log.slice(0, this.cfg.share.max).map(e => [e.at.slice(0, 16), Meter.slugOf(e.path) || e.path, e.kind,
            e.depth == null ? 1 : e.depth, e.cost, e.declined ? e.declined.reason : '', e.persona || 'me',
            (e.rating && e.rating.useful) || 0, (e.rating && e.rating.more) || 0, (e.rating && e.rating.detail) || 0])
        const json = { v: 1, site: this.cfg.share.site || location.host, at: new Date().toISOString(),
                       balance: s.balance, spent: s.spent, declined: s.declined, reads: s.reads, topups: s.topups.length,
                       active: s.active, personas, topics: topics.map(t => [t, Math.round(100 * me.topics[t] / sum)]),
                       cols: ['at', 'page', 'kind', 'depth', 'cost', 'declined', 'persona', 'useful', 'more', 'detail'], log: rows }
        const lines = [`My reading on ${json.site}, shared on ${json.at.slice(0, 10)}`]
        if (who && who.name) lines.push(`Name: ${who.name}`)
        if (who && who.email) lines.push(`Email: ${who.email}`)
        if (who && who.note) lines.push(`Note: ${who.note}`)
        lines.push(`Pages read: ${s.reads} · spent ${this.money(s.spent)} · balance ${this.money(s.balance)} · declined ${this.money(s.declined)} · top-ups ${s.topups.length}`)
        lines.push(`Topics: ${topics.map(t => `${label(t)} ${Math.round(100 * me.topics[t] / sum)}%`).join(' · ') || 'none yet'}`)
        lines.push(`Personas: ${personas.map(p => `${p.name}${p.id === s.active ? ' (active)' : ''}: ${p.reads} read, ${p.on.length} kept, ${p.off.length} out`).join(' · ')}`)
        lines.push('', 'Pages, newest first (when, page, how much read, cost, ratings, declined, persona):')
        for (const r of rows.slice(0, 40)) lines.push(`${r[0].replace('T', ' ')}  ${r[1]}  ${Math.round(r[3] * 100)}%  ${this.pence(r[4])}`
            + `${r[7] || r[8] || r[9] ? `  rated useful ${r[7] || '-'}/5, more ${r[8] || '-'}/5, detail ${r[9] || '-'}/5` : ''}${r[5] ? `  declined: ${r[5]}` : ''}${r[6] !== 'me' ? `  [${r[6]}]` : ''}`)
        if (rows.length > 40) lines.push(`… and ${rows.length - 40} more in the data below`)
        lines.push('', 'Data:', JSON.stringify(json))
        return { text: lines.join('\n'), json, pages: rows.length }
    }

    noteShared(how, pages) {
        this.state.shares = [{ at: new Date().toISOString(), how, pages }, ...(this.state.shares || [])].slice(0, 20)
        this.save()
        this._emit('shared', { how, pages })
    }

    async feed() {
        if (!this.cfg.picks.feed) return null
        if (!this._feed) {
            this._feed = fetch(this.cfg.root + this.cfg.picks.feed)
                .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
                .catch(() => null)
        }
        return this._feed
    }

    /** Unread articles the persona would want, best first: topics plus twice the shared tags. */
    picks(feed, k, id) {
        const p    = this.profile(feed, id)
        const read = new Set(this.state.log.map(e => Meter.slugOf(e.path)))
        const skip = new Set([...p.off, ...p.on])
        return (feed.articles || [])
            .filter(a => !read.has(a.slug) && !skip.has(a.slug))
            .map(a => ({ a, s: (a.topics || []).reduce((n, t) => n + (p.topics[t] || 0), 0)
                             + 2 * (a.tags || []).reduce((n, t) => n + Math.max(p.tags[t] || 0, 0), 0) }))
            .filter(x => x.s > 0)
            .sort((x, y) => y.s - x.s || (y.a.date > x.a.date ? 1 : -1))
            .slice(0, k)
            .map(x => x.a)
    }

    topicLabel(feed, id) {
        const t = (feed && feed.topics || []).find(x => x.id === id)
        return t ? t.label : id
    }
}

export const meter = new Meter()
