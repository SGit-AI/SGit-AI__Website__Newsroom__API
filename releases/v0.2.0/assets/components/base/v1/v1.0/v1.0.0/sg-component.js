/**
 * sg-component — the base class components on this site extend.
 *
 * Vendored from the estate's contract (https://coding.sgit.ai/javascript/index.html), by way of
 * the copy pt.newsroom.sgit.ai keeps at assets/components/base/v1/v1.0/v1.0.0/sg-component.js,
 * with its state names put back into English (data-state="ready" | "error"). Native web
 * components, no framework, no build step: the browser is the runtime.
 *
 * THE CONTRACT. A component overrides exactly four things:
 *
 *     static jsUrl = import.meta.url   self-location; without it the component cannot find its
 *                                      own markup and styles
 *     get resourceName()               the basename of the sibling .tpl and .css
 *     get sharedCssPaths()             shared sheets to adopt, if any
 *     onReady()                        the lifecycle hook; never connectedCallback directly
 *
 * TWO DEPARTURES FROM THE ESTATE, inherited from the pt.newsroom copy and for the same reasons:
 * everything is held on this site and nothing is fetched from a third party at runtime, and the
 * markup file is <name>.tpl rather than <name>.html, because on this site every .html file is a
 * page to the validator and a fragment is not a page.
 *
 * @module sg-component
 * @version 1.0.0
 */

const _cache = new Map()

async function _fetchText(url) {
    if (!_cache.has(url)) {
        _cache.set(url, fetch(url).then(r => {
            if (!r.ok) throw new Error(`${r.status} ${url}`)
            return r.text()
        }))
    }
    return _cache.get(url)
}

const _sheets = new Map()

async function _sheet(url) {
    if (!_sheets.has(url)) {
        _sheets.set(url, _fetchText(url).then(css => {
            const s = new CSSStyleSheet()
            s.replaceSync(css)
            return s
        }))
    }
    return _sheets.get(url)
}

export class SgComponent extends HTMLElement {

    static jsUrl = import.meta.url

    get resourceName() {
        throw new Error(`${this.constructor.name} must define get resourceName()`)
    }

    get sharedCssPaths() {
        return []
    }

    /** Called once the shadow root is populated. Override this, never connectedCallback. */
    onReady() {}

    /** Say, on the host element where a checker can read it, that this component failed. */
    failed(why) {
        this.setAttribute('data-state', 'error')
        this.setAttribute('data-error', String(why).slice(0, 300))
        this.emit(`${this.resourceName}:error`, { why: String(why) })
    }

    /** Set by the base class once onReady() has returned. */
    ready() {
        if (this.getAttribute('data-state') !== 'error') this.setAttribute('data-state', 'ready')
    }

    /** Resolve a path against the component's own directory. */
    resolve(relative) {
        const base = this.constructor.jsUrl
        if (!base) throw new Error(`${this.constructor.name} must set static jsUrl = import.meta.url`)
        return new URL(relative, base).href
    }

    async connectedCallback() {
        if (this._connected) return
        this._connected = true
        const name   = this.resourceName
        const shadow = this.attachShadow({ mode: 'open' })
        try {
            const [markup, own, ...shared] = await Promise.all([
                _fetchText(this.resolve(`${name}.tpl`)),
                _sheet(this.resolve(`${name}.css`)),
                ...this.sharedCssPaths.map(p => _sheet(p)),
            ])
            shadow.adoptedStyleSheets = [...shared, own]
            shadow.innerHTML = markup
            await this.onReady()
            this.ready()
        } catch (err) {
            this.failed(err.message)
            shadow.innerHTML = ''
            const p = document.createElement('p')
            p.style.cssText = 'font:13px/1.5 ui-monospace,monospace;color:#b91c1c;padding:12px'
            p.textContent = `<${name}> did not load: ${err.message}`
            shadow.appendChild(p)
        }
    }

    /** Dispatch a namespaced event that escapes the shadow root. */
    emit(name, detail) {
        document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
    }

    /** Query this component's shadow root. */
    $(sel)  { return this.shadowRoot.querySelector(sel) }
    $$(sel) { return [...this.shadowRoot.querySelectorAll(sel)] }
}
