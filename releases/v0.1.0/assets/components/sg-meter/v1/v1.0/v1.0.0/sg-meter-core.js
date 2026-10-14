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
 * Configuration: <script type="application/json" id="sg-meter-config">{...}</script> on the page,
 * or window.SG_METER_CONFIG. Every key has a default (DEFAULTS below).
 *
 * Events, on document: sg:meter.charged, sg:meter.declined, sg:meter.toppedup, sg:meter.reset,
 * sg:meter.changed (any state change; the elements repaint on it).
 *
 * @module sg-meter-core
 * @version 1.0.0
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
    picks      : { feed: '', base: '' },    // a JSON feed of {articles:[{slug,title,date,teaser,topics}], topics:[{id,label}]}
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
        return { v: 2, created: new Date().toISOString(), balance: this.cfg.start, spent: 0, reads: 0, declined: 0,
                 paused: false, log: [], topups: [], cart: [], sessions: [] }
    }

    _read() {
        try {
            const raw = localStorage.getItem(this.cfg.storageKey)
            if (!raw) return this._fresh()
            const s = { ...this._fresh(), ...JSON.parse(raw) }
            if (s.waived && !s.declined) s.declined = s.waived       // v1 name
            s.v = 2
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
                       path, title: meta.title, kind: meta.kind, topics: meta.topics, price: this.price, depth: 0, cost: 0 }
        this.state.log.unshift(this.entry)
        this.state.log = this.state.log.slice(0, LOG_MAX)
        this.state.reads += 1
        seen[path] = this.entry.id
        this._setSeen(seen)
        this.status = 'reading'
    }

    /** Grow the charge to the given depth (0..1). Only ever grows. */
    reach(depth) {
        const e = this.entry
        if (!e || this.status !== 'reading') return
        const d = this.cfg.depth ? Math.round(Math.max(0, Math.min(1, depth)) * 20) / 20 : 1
        if (d <= e.depth && e.cost > 0) return
        const cost  = r1(this.price * Math.max(d, this.cfg.minDepth))
        const delta = r1(cost - e.cost)
        e.depth = Math.max(d, e.depth)
        e.cost  = cost
        this.state.balance = r1(this.state.balance - delta)
        this.state.spent   = r1(this.state.spent + delta)
        this.save()
        this._emit('charged', { path: e.path, depth: e.depth, cost, balance: this.state.balance })
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

    // ------------------------------------------------------------ personalisation
    profile() {
        const w = {}
        let total = 0
        for (const e of this.state.log) {
            for (const t of e.topics || []) {
                const v = e.declined ? (e.declined.reason === 'not-relevant' ? -2 : 0) : e.cost
                w[t] = (w[t] || 0) + v
                total += Math.max(v, 0)
            }
        }
        return { weights: w, total }
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

    picks(feed, k) {
        const p    = this.profile()
        const read = new Set(this.state.log.map(e => e.path.replace(/^.*\//, '')))
        return (feed.articles || [])
            .filter(a => !read.has(`${a.slug}.html`))
            .map(a => ({ a, s: (a.topics || []).reduce((n, t) => n + (p.weights[t] || 0), 0) }))
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
