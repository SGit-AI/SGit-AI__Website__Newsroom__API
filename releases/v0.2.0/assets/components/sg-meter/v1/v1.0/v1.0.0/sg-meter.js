/**
 * sg-meter — a reading meter for any website, kept entirely in the reader's browser.
 *
 * One element, six views, one shared meter (sg-meter-core.js):
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
 *   <sg-meter view="picks"></sg-meter>        unread pages from the reader's most-read topics; hidden until
 *                                             there is a history to pick from
 *
 * It is an honesty box, not a paywall: it never blocks, it lets credit go below zero, and it says
 * on every view that it lives in this browser only. Data from the page and the reader is only
 * ever set with textContent.
 *
 * @module sg-meter
 * @version 1.0.0
 */

import { SgComponent } from '../../../../base/v1/v1.0/v1.0.0/sg-component.js'
import { meter, REASONS } from './sg-meter-core.js'

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
        this._set(
            h('span', {}, 'This page has cost you ', h('b', {}, meter.pence(e.cost)), ` so far, for ${Math.round(e.depth * 100)}% of it read (${meter.pence(e.price)} to the end). `,
              h('a', { href: this._root + meter.cfg.links.account }, 'Your account')),
            h('button', { type: 'button', class: 'link', onclick: () => { this._reasonsOpen = !open; this._page() } },
              open ? 'Keep paying' : 'Not worth it? Don’t charge me'),
            open ? h('span', { class: 'reasons', role: 'group', 'aria-label': 'Why not?' },
                REASONS.map(([id, label]) => h('button', { type: 'button', class: 'btn', onclick: () => meter.decline(id) }, label))) : null,
        )
    }

    // ------------------------------------------------------------ picks
    async _picks() {
        if (meter.profile().total <= 0) { this.hidden = true; return }
        const feed = await meter.feed()
        const list = feed ? meter.picks(feed, Number(this.getAttribute('count') || 4)) : []
        if (!list.length) { this.hidden = true; return }
        this.hidden = false
        this._set(
            h('h2', { class: 'sect' }, 'Picked for you ', h('a', { href: this._root + meter.cfg.links.account }, 'from your reading, in this browser only →')),
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
        const p   = meter.profile()
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
        const picksBox = h('div', {}, h('p', { class: 'dim' }, p.total > 0 ? 'Working it out from your history…'
            : 'Nothing yet. Read a few pages and this fills with unread ones from the topics you read most.'))
        const topics = Object.keys(p.weights).filter(t => p.weights[t] > 0).sort((a, b) => p.weights[b] - p.weights[a])
        const topicRows = topics.map(t => {
            const pc = Math.round(100 * p.weights[t] / p.total)
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
            h('h2', { id: 'foryou' }, 'Picked for you'), picksBox,
            h('h2', { id: 'topics' }, 'What you have paid to read, by topic'),
            topicRows.length ? topicRows : h('p', { class: 'dim' }, 'Nothing yet.'),
            h('h2', { id: 'history' }, 'History'),
            rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('tr', {}, ['When', 'Page', 'Kind', 'Cost (read)'].map(x => h('th', {}, x))), rows))
                        : h('p', { class: 'dim' }, 'No pages read yet in this browser.'),
            h('h2', { id: 'receipts' }, 'Top-ups'),
            tops.length ? h('ul', {}, tops) : h('p', { class: 'dim' }, `None yet. You started with ${meter.money(meter.cfg.start)} of credit.`),
        )
        if (p.total > 0) {
            const feed = await meter.feed()
            if (!feed) return
            this.$$('[data-topic]').forEach(el => { el.textContent = meter.topicLabel(feed, el.getAttribute('data-topic')) })
            const list = meter.picks(feed, 6)
            picksBox.replaceChildren(list.length
                ? h('div', {}, h('p', { class: 'dim' }, 'Unread pages from the topics you have read most; a page you marked "not relevant" counts against its topics. Worked out here, from the history below.'), this._pickList(feed, list))
                : h('p', { class: 'dim' }, 'You have read everything in your topics.'))
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
