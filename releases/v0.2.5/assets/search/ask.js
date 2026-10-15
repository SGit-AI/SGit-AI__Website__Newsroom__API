/**
 * ask.js: ask the site a question, answered by a model from the passages the search finds (card 033).
 *
 * The question is searched with the same index as the search page (assets/search/search.js). The best passages, one or
 * two per page from the top pages, are numbered and given to a model with one instruction: answer only from them, cite
 * them by number, and say so when they do not hold the answer. The answer is shown with the passages beside it, each
 * linked to its page and section, so every claim can be checked where it came from.
 *
 * Two engines, and the page says which answered:
 *   - Chrome's built-in model (the Prompt API: LanguageModel, or the older window.ai.languageModel), when the browser has
 *     it: it runs on the reader's machine, with no key, and nothing is sent anywhere.
 *   - The reader's own OpenRouter key, when they paste one: kept in this tab's session storage unless they ask to keep it
 *     in this browser; sent to openrouter.ai with the question and the passages, and nowhere else. The page shows what
 *     was sent and the model that answered.
 * With neither, the passages are shown alone.
 *
 * The pure functions (passagesFor, buildMessages, linkCitations) run in Node for the tests.
 *
 * @module ask
 */
import { search, parseQuery } from './search.js'

export const OR_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const OR_DEFAULT_MODEL = 'openrouter/auto'
const KEY = 'sgit.ask.openrouter-key', MODEL = 'sgit.ask.openrouter-model'
export const SYSTEM = 'You answer questions about newsroom.sgit.ai, a newsroom run by agents and one person, Dinis Cruz. ' +
    'Answer ONLY from the numbered passages you are given. Cite every claim with the passage number in square brackets, like [2]. ' +
    'If the passages do not contain the answer, say that they do not, and say which passage comes closest. ' +
    'Be brief: a few sentences, plain text, no headings. Quote short phrases exactly when they matter.'

/** The passages for a question: the best paragraph of each of the top pages, and a second one from the very best. */
export function passagesFor(ix, question, { pages = 6, max = 8, chars = 700 } = {}) {
    const q = parseQuery(question)
    const res = search(ix, q, { limit: pages * 2 })
    const out = []
    for (const r of res) {
        if (out.length >= max) break
        const d = r.doc
        const units = ix.units.filter(u => !u.meta && u.doc === d.i && !u.ver)
        const scored = units.map(u => [q.terms.reduce((s, t) => s + (u.tf.get(t) || 0), 0), u]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0])
        const picks = (scored.length ? scored.slice(0, out.length === 0 ? 2 : 1).map(x => x[1]) : [])
        if (!picks.length) out.push({ n: out.length + 1, title: d.t, u: d.u, anchor: '', text: (d.x || d.t).slice(0, chars), kind: d.k, num: d.n || null })
        for (const u of picks) {
            if (out.length >= max) break
            out.push({ n: out.length + 1, title: d.t, u: d.u, anchor: u.anchor || '', text: u.text.length > chars ? u.text.slice(0, chars).replace(/\s+\S*$/, '') + ' …' : u.text, kind: d.k, num: d.n || null })
        }
        if (out.filter(p => p.u === d.u).length && new Set(out.map(p => p.u)).size >= pages) break
    }
    return out
}

/** The messages for the model: the instruction, then the question with the numbered passages. */
export function buildMessages(question, passages) {
    const ctx = passages.map(p => `[${p.n}] ${p.title}${p.num ? ` (article No. ${p.num})` : ''}, https://newsroom.sgit.ai/${p.u}${p.anchor && !p.u.includes('#') ? '#' + p.anchor : ''}\n${p.text}`).join('\n\n')
    return [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Question: ${question}\n\nPassages:\n\n${ctx}\n\nAnswer from the passages, citing them by number.` }]
}

/** An answer's text as runs: [[text, null]] and [[ '[2]', 2 ]] for each citation of a passage that exists. */
export function linkCitations(text, count) {
    const out = []
    let pos = 0
    for (const m of String(text || '').matchAll(/\[(\d{1,2})(?:\s*,\s*(\d{1,2}))*\]/g)) {
        const nums = m[0].slice(1, -1).split(/\s*,\s*/).map(Number)
        if (!nums.every(n => n >= 1 && n <= count)) continue
        if (m.index > pos) out.push([text.slice(pos, m.index), null])
        nums.forEach((n, i) => out.push([`[${n}]`, n]))
        pos = m.index + m[0].length
    }
    if (pos < String(text || '').length) out.push([String(text).slice(pos), null])
    return out
}

/** Chrome's built-in model, when there is one: the API object, or null. */
export function builtIn() {
    if (typeof globalThis === 'undefined') return null
    if (globalThis.LanguageModel && typeof globalThis.LanguageModel.create === 'function') return { api: globalThis.LanguageModel, name: 'Chrome\'s built-in model (LanguageModel)' }
    if (globalThis.ai && globalThis.ai.languageModel && typeof globalThis.ai.languageModel.create === 'function') return { api: globalThis.ai.languageModel, name: 'Chrome\'s built-in model (window.ai)' }
    return null
}

// ------------------------------------------------------------ the page
const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v) }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
}
const store = {
    get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || '' } catch (e) { return '' } },
    set(k, v, keep) { try { sessionStorage.setItem(k, v); if (keep) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch (e) { /* memory only */ } },
    clear(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k) } catch (e) { /* fine */ } },
    kept(k) { try { return !!localStorage.getItem(k) } catch (e) { return false } },
}

export function mountAsk(mount) {
    const ROOT = new URL(document.documentElement.getAttribute('data-root') || '', document.baseURI)   // the page's site root; the code is served from api.newsroom.sgit.ai
    const input = mount.querySelector('#search-q')
    const out = h('section', { class: 'ask', id: 'ask-out', hidden: true, 'aria-live': 'polite' })
    const askBtn = h('button', { type: 'button', class: 'btn', id: 'ask-btn', onclick: () => ask() }, 'Ask')
    const box = mount.querySelector('.search-box'); box.append(askBtn)
    const lm = builtIn()
    const keyIn = h('input', { type: 'password', id: 'ask-key', autocomplete: 'off', placeholder: 'sk-or-…', value: store.get(KEY) })
    const modelIn = h('input', { type: 'text', id: 'ask-model', autocomplete: 'off', spellcheck: 'false', value: store.get(MODEL) || OR_DEFAULT_MODEL })
    const keep = h('input', { type: 'checkbox', id: 'ask-keep' }); keep.checked = store.kept(KEY)
    const engineLine = h('p', { class: 'dim', id: 'ask-engine' })
    const settings = h('details', { class: 'ask-settings', id: 'ask-settings' },
        h('summary', {}, 'How questions are answered'),
        engineLine,
        h('label', {}, 'Your OpenRouter key ', keyIn),
        h('label', {}, 'Model ', modelIn),
        h('label', { class: 'keep' }, keep, ' Keep the key in this browser (otherwise it is forgotten when the tab closes)'),
        h('div', { class: 'acts' },
            h('button', { type: 'button', class: 'btn sm', id: 'ask-save', onclick: () => { save(); drawEngine() } }, 'Use this key'),
            h('button', { type: 'button', class: 'btn sm', id: 'ask-forget', onclick: () => { store.clear(KEY); keyIn.value = ''; keep.checked = false; drawEngine() } }, 'Forget the key')),
        h('p', { class: 'dim' }, 'The key is sent to openrouter.ai with your question and the passages, and nowhere else: this site has no server to send it to. ',
            h('a', { href: 'https://openrouter.ai/keys', target: '_blank', rel: 'noopener' }, 'OpenRouter keys'), '.'))
    mount.querySelector('#search-filters').before(settings)
    mount.querySelector('#search-status').after(out)
    function save() { const k = keyIn.value.trim(); if (k) store.set(KEY, k, keep.checked); else store.clear(KEY); store.set(MODEL, modelIn.value.trim() || OR_DEFAULT_MODEL, keep.checked) }
    function drawEngine() {
        const k = store.get(KEY)
        engineLine.textContent = lm ? `This browser has ${lm.name}: questions are answered on this device, with no key and nothing sent.${k ? ' Your OpenRouter key is set too, and is used when the built-in model cannot answer.' : ''}`
            : k ? `Questions are answered by openrouter.ai with your key, model ${store.get(MODEL) || OR_DEFAULT_MODEL}. The question and the passages are sent there, and nowhere else.`
            : 'No model is set up here: this browser has no built-in model, and no OpenRouter key is set. Ask shows the passages the search finds; paste a key to have them answered.'
    }
    drawEngine()

    async function ask() {
        const question = input.value.trim()
        if (!question) { input.focus(); return }
        const s = mount._search
        out.hidden = false
        if (!s || !s.ix || !s.ix.hasText) { out.replaceChildren(h('p', { class: 'dim' }, 'The index is still loading; ask again in a moment.')); return }
        const passages = passagesFor(s.ix, question)
        const list = h('ol', { class: 'ask-passages', id: 'ask-passages' }, ...passages.map(p => h('li', { id: `ask-p-${p.n}`, value: String(p.n) },
            h('a', { href: new URL(p.u + (p.anchor && !p.u.includes('#') ? '#' + p.anchor : ''), ROOT).href }, p.title), p.num ? h('span', { class: 'dim' }, ` · No. ${p.num}`) : null,
            h('p', {}, p.text))))
        const answer = h('div', { class: 'ask-answer', id: 'ask-answer' }, h('p', { class: 'dim' }, passages.length ? 'Asking…' : 'The search found nothing to answer from.'))
        const by = h('p', { class: 'dim', id: 'ask-by' })
        out.replaceChildren(h('h2', {}, 'The answer'), answer, by, h('h3', {}, `From these passages (${passages.length})`), list)
        if (!passages.length) return
        const messages = buildMessages(question, passages)
        const sent = h('details', { class: 'ask-sent', id: 'ask-sent' }, h('summary', {}, 'What the model is given: the instruction, your question and these passages, nothing else'),
            h('pre', {}, messages.map(m => `${m.role === 'system' ? 'INSTRUCTION' : 'QUESTION AND PASSAGES'}\n${m.content}`).join('\n\n')))
        const show = text => answer.replaceChildren(...String(text).trim().split(/\n{2,}/).map(par => h('p', {}, ...linkCitations(par, passages.length).map(([t, n]) => n ? h('a', { href: `#ask-p-${n}`, class: 'cite' }, t) : t))))
        askBtn.disabled = true
        let fellBack = ''
        try {
            if (lm || store.get(KEY)) by.after(sent)
            if (lm) {
                try {
                    const opts = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }
                    const avail = typeof lm.api.availability === 'function' ? await lm.api.availability(opts) : 'available'
                    if (avail === 'unavailable' || avail === 'no') throw new Error('the built-in model is unavailable on this device')
                    if (avail !== 'available' && avail !== 'readily') answer.replaceChildren(h('p', { class: 'dim' }, 'Chrome is downloading its model, once; the first answer waits for it…'))
                    const session = await lm.api.create({ ...opts, initialPrompts: [messages[0]], monitor(m) { try { m.addEventListener('downloadprogress', e => answer.replaceChildren(h('p', { class: 'dim' }, `Chrome is downloading its model, once: ${Math.round((e.loaded || 0) * 100)}%…`))) } catch (e) { /* fine */ } } })
                    answer.replaceChildren(h('p', { class: 'dim' }, `Asking ${lm.name}, on this device…`))
                    const text = await session.prompt(messages[1].content)
                    show(text); by.textContent = `Answered by ${lm.name}, on this device. Nothing was sent anywhere.`
                    try { session.destroy && session.destroy() } catch (e) { /* fine */ }
                    return
                } catch (e) {
                    if (!store.get(KEY)) throw e
                    fellBack = `The built-in model did not answer (${e.message || e}), so openrouter.ai was asked. `
                }
            }
            const key = store.get(KEY)
            if (!key) { answer.replaceChildren(h('p', { class: 'dim' }, 'No model is set up here, so the passages are shown alone. Paste an OpenRouter key under “How questions are answered” to have them answered.')); by.textContent = ''; return }
            const model = store.get(MODEL) || OR_DEFAULT_MODEL
            const chars = messages.reduce((n, m) => n + m.content.length, 0)
            answer.replaceChildren(h('p', { class: 'dim' }, `Asking openrouter.ai, model ${model}: the question and ${passages.length} passages, ${chars.toLocaleString()} characters…`))
            const r = await fetch(OR_ENDPOINT, { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': location.origin, 'X-Title': 'SGit Newsroom' }, body: JSON.stringify({ model, messages, max_tokens: 700 }) })
            const j = await r.json().catch(() => null)
            if (!r.ok || !j || !j.choices || !j.choices[0]) throw new Error((j && j.error && j.error.message) || `openrouter.ai answered ${r.status}`)
            show(j.choices[0].message.content || '')
            by.textContent = `${fellBack}Answered by openrouter.ai, model ${j.model || model}, with your key. Sent: the question and ${passages.length} passages, ${chars.toLocaleString()} characters${j.usage ? `; ${j.usage.total_tokens} tokens` : ''}.`
        } catch (e) {
            answer.replaceChildren(h('p', { class: 'warn' }, `No answer: ${e.message || e}. The passages the search found are below.`))
        } finally { askBtn.disabled = false }
    }
    if (new URLSearchParams(location.search).get('ask') === '1') {
        const wait = setInterval(() => { if (mount._search && mount._search.ix && mount._search.ix.hasText) { clearInterval(wait); ask() } }, 200)
    }
}
