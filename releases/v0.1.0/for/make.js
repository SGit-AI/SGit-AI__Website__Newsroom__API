/**
 * make.js: the page that makes a reading list, and shows it as the recipient will see it.
 *
 * Choose articles (search, topic, persona), put each in "to read" or "worth a look", order them, type two first
 * names and an optional note, pick what to follow, and copy the link. The preview is the real thing: the list
 * is turned into a link, the link is read back by the same parser /for/ uses, and that is what is drawn, so
 * whatever the page would leave out is left out here too and says so.
 *
 * It runs in the browser and sends nothing. The list is kept in this page's own address after the #, in the
 * same form as the link it makes, so a list in progress can be bookmarked, and #r=65 starts one with article 65
 * in it (the line at the foot of every article).
 *
 * @module make
 */
import { LIMITS, build, cleanName, cleanNote, cleanEmail, contextFrom, h, parse, personaName, renderList, specOf } from './reading-list.js'

const NOTHING = { from: '', to: '', note: '', email: '', read: [], look: [], follow: [] }

export async function makeList(opts) {
    const mount = opts.mount
    let core, idsDoc
    try {
        ;[core, idsDoc] = await Promise.all([import(opts.core), fetch(opts.ids).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })])
    } catch (e) {
        mount.replaceChildren(h('p', { class: 'warn' }, 'The list of articles could not be loaded, so a list cannot be made yet. Try again in a moment.'))
        return
    }
    const meter = core.meter
    const ctx = contextFrom(idsDoc, meter.cfg.personas.presets)
    const live = (idsDoc.articles || []).filter(e => !e.withdrawn).sort((a, b) => b.n - a.n)
    const topicLabel = id => (ctx.topics.find(t => t.id === id) || { label: id }).label
    const price = e => meter.priceOf({ kind: 'article', date: e.date })
    const money = n => n >= 100 ? meter.money(n) : n === 0 ? '0p' : meter.pence(n)
    const byN = n => ctx.byNumber.get(n)

    // ---------------------------------------------------------------- the state: a spec, as build() takes it
    let S = { ...NOTHING }
    const fromFragment = () => { const p = parse(location.hash, ctx); S = { ...specOf(p) } }
    const fragment = () => build('', S)
    const total = () => S.read.length + S.look.length
    fromFragment()

    // ---------------------------------------------------------------- the form
    const field = (label, input, hint) => h('label', { class: 'mk-field' }, h('span', { class: 'mk-label' }, label), input, hint || null)
    const msg = h('p', { class: 'mk-msg', 'aria-live': 'polite' })
    const inFrom = h('input', { type: 'text', name: 'from', maxlength: LIMITS.name, placeholder: 'Dinis', autocomplete: 'off', value: S.from })
    const inTo   = h('input', { type: 'text', name: 'to', maxlength: LIMITS.name, placeholder: 'Steve', autocomplete: 'off', value: S.to })
    const inNote = h('textarea', { name: 'n', rows: '2', maxlength: LIMITS.note, placeholder: 'Start with the first one, it is the short version.' })
    inNote.value = S.note
    const noteCount = h('span', { class: 'mk-count' })
    const inEmail = h('input', { type: 'email', name: 'e', maxlength: LIMITS.email, placeholder: 'you@example.com', autocomplete: 'off', value: S.email })
    const problems = {}
    const readField = (key, el, clean, label) => {
        const c = clean(el.value)
        problems[key] = c.ok ? '' : `${label}: ${c.why}`
        S[key] = c.ok ? c.value : ''
        el.setAttribute('aria-invalid', c.ok ? 'false' : 'true')
    }
    const onText = () => {
        readField('from', inFrom, cleanName, 'Sender’s name'); readField('to', inTo, cleanName, 'Recipient’s name')
        readField('note', inNote, cleanNote, 'Note'); readField('email', inEmail, cleanEmail, 'Reply address')
        noteCount.textContent = `${inNote.value.length} of ${LIMITS.note}`
        msg.textContent = Object.values(problems).filter(Boolean).join(' · ')
        sync()
    }
    for (const el of [inFrom, inTo, inNote, inEmail]) el.addEventListener('input', onText)

    // ---------------------------------------------------------------- picking
    const q = h('input', { type: 'search', placeholder: 'Search title, topic, number', 'aria-label': 'Search the articles' })
    const topic = h('select', { 'aria-label': 'Topic' }, h('option', { value: '' }, 'Any topic'), ctx.topics.map(t => h('option', { value: t.id }, t.label)))
    const persona = h('select', { 'aria-label': 'Persona' }, h('option', { value: '' }, 'Any persona'),
        ctx.personas.map(p => h('option', { value: p.id }, `${p.name}, ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}`)))
    const shownCount = h('p', { class: 'mk-count', 'aria-live': 'polite' })
    const pickList = h('ul', { class: 'mk-pick' })
    const rows = new Map()
    const rowFor = e => {
        const read = h('button', { type: 'button', class: 'rl-btn sm', 'aria-pressed': 'false', onclick: () => put(e.n, 'read') }, 'Read')
        const look = h('button', { type: 'button', class: 'rl-btn sm', 'aria-pressed': 'false', onclick: () => put(e.n, 'look') }, 'Look')
        const li = h('li', { class: 'mk-row' }, h('span', { class: 'rl-n' }, `No. ${e.n}`),
            h('div', { class: 'mk-what' }, h('b', {}, e.title),
                h('span', { class: 'rl-meta' }, [e.date, e.minutes ? `${e.minutes} min` : null, (e.topics || []).map(topicLabel).join(', ')].filter(Boolean).join(' · '))),
            h('span', { class: 'mk-btns' }, read, look))
        rows.set(e.n, { li, read, look, hay: `${e.n} ${e.title} ${e.teaser || ''} ${(e.topics || []).map(topicLabel).join(' ')}`.toLowerCase() })
        return li
    }
    pickList.append(...live.map(rowFor))
    const filter = () => {
        const words = q.value.toLowerCase().split(/\s+/).filter(Boolean)
        let n = 0
        for (const e of live) {
            const r = rows.get(e.n)
            const ok = (!topic.value || (e.topics || []).includes(topic.value)) && (!persona.value || (e.personas || []).includes(persona.value)) && words.every(w => r.hay.includes(w))
            r.li.hidden = !ok
            if (ok) n++
        }
        shownCount.textContent = `${n} of ${live.length} articles`
    }
    for (const el of [q, topic, persona]) el.addEventListener('input', filter)

    /** Put an article in a group; pressing the group it is already in takes it out. */
    const put = (n, group) => {
        const other = group === 'read' ? 'look' : 'read'
        if (S[group].includes(n)) S[group] = S[group].filter(x => x !== n)
        else {
            if (!S[other].includes(n) && total() >= LIMITS.list) return
            S[other] = S[other].filter(x => x !== n)
            S[group] = [...S[group], n]
        }
        paint()
    }
    const move = (n, group, by) => {
        const l = [...S[group]], i = l.indexOf(n), j = i + by
        if (i < 0 || j < 0 || j >= l.length) return
        ;[l[i], l[j]] = [l[j], l[i]]
        S[group] = l
        paint()
    }
    const drop = (n, group, beforeN) => {
        S.read = S.read.filter(x => x !== n); S.look = S.look.filter(x => x !== n)
        const l = [...S[group]]
        const i = beforeN == null ? -1 : l.indexOf(beforeN)
        if (i < 0) l.push(n); else l.splice(i, 0, n)
        S[group] = l
        paint()
    }

    // ---------------------------------------------------------------- the ordered list
    const orderOf = (group, label, empty) => {
        const ol = h('ol', { class: 'mk-order', 'data-group': group })
        ol.addEventListener('dragover', ev => { ev.preventDefault(); ol.classList.add('over') })
        ol.addEventListener('dragleave', () => ol.classList.remove('over'))
        ol.addEventListener('drop', ev => { ev.preventDefault(); ol.classList.remove('over'); const n = Number(ev.dataTransfer.getData('text/plain')); if (byN(n) && ev.target === ol) drop(n, group, null) })
        return { ol, label, empty, group }
    }
    const readBox = orderOf('read', 'To read, in this order', 'Nothing yet. Choose articles above with Read.')
    const lookBox = orderOf('look', 'Worth a look', 'Nothing yet. Choose articles above with Look.')
    const paintOrder = box => {
        const l = S[box.group]
        box.ol.replaceChildren(...(l.length ? l.map((n, i) => {
            const e = byN(n)
            const li = h('li', { class: 'mk-item', draggable: 'true' },
                h('span', { class: 'mk-grip', 'aria-hidden': 'true' }, '⠿'),
                h('span', { class: 'rl-n' }, `No. ${n}`),
                h('span', { class: 'mk-what' }, h('b', {}, e.title)),
                h('span', { class: 'mk-btns' },
                    h('button', { type: 'button', class: 'rl-btn sm', 'aria-label': `Move No. ${n} up`, disabled: i === 0, onclick: () => move(n, box.group, -1) }, '↑'),
                    h('button', { type: 'button', class: 'rl-btn sm', 'aria-label': `Move No. ${n} down`, disabled: i === l.length - 1, onclick: () => move(n, box.group, 1) }, '↓'),
                    h('button', { type: 'button', class: 'rl-btn sm', onclick: () => put(n, box.group === 'read' ? 'look' : 'read') }, box.group === 'read' ? 'To look' : 'To read'),
                    h('button', { type: 'button', class: 'rl-btn sm', 'aria-label': `Take No. ${n} out`, onclick: () => put(n, box.group) }, 'Remove')))
            li.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', String(n)); ev.dataTransfer.effectAllowed = 'move'; li.classList.add('drag') })
            li.addEventListener('dragend', () => li.classList.remove('drag'))
            li.addEventListener('dragover', ev => { ev.preventDefault() })
            li.addEventListener('drop', ev => { ev.preventDefault(); ev.stopPropagation(); box.ol.classList.remove('over'); const m = Number(ev.dataTransfer.getData('text/plain')); if (byN(m) && m !== n) drop(m, box.group, n) })
            return li
        }) : [h('li', { class: 'mk-empty' }, box.empty)]))
    }

    // ---------------------------------------------------------------- follow
    const follows = h('div', { class: 'mk-follows' })
    const followBox = (tok, label, hint) => {
        const cb = h('input', { type: 'checkbox', value: tok, onchange: () => { S.follow = cb.checked ? [...S.follow, tok] : S.follow.filter(x => x !== tok); sync() } })
        return h('label', { class: 'mk-check' }, cb, h('span', {}, h('b', {}, label), hint ? h('i', {}, ` ${hint}`) : null))
    }
    follows.append(
        h('p', { class: 'mk-label' }, 'Personas'),
        ...ctx.personas.map(p => followBox(p.id, `${p.name}, ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}`)),
        h('p', { class: 'mk-label' }, 'Collections'),
        ...ctx.collections.map(c => followBox(`c:${c.slug}`, c.title)))

    // ---------------------------------------------------------------- the link and the preview
    const out = h('textarea', { class: 'mk-link', readonly: true, rows: '4', 'aria-label': 'The link', spellcheck: 'false' })
    const facts = h('p', { class: 'mk-count', 'aria-live': 'polite' })
    const copy = h('button', { type: 'button', class: 'rl-btn primary', onclick: async () => {
        const was = copy.textContent
        try { await navigator.clipboard.writeText(out.value); copy.textContent = 'Copied' }
        catch (e) { out.focus(); out.select(); try { document.execCommand('copy'); copy.textContent = 'Copied' } catch (e2) { copy.textContent = 'Select and copy' } }
        setTimeout(() => { copy.textContent = was }, 1800)
    } }, 'Copy link')
    const open = h('a', { class: 'rl-btn', target: '_blank', rel: 'noopener' }, 'Open as the recipient')
    const loadIn = h('input', { type: 'text', placeholder: 'Paste a link made here, or by an agent', 'aria-label': 'A link to edit' })
    const loadMsg = h('p', { class: 'mk-msg', 'aria-live': 'polite' })
    const load = () => {
        const raw = loadIn.value.trim()
        const i = raw.indexOf('#')
        const p = parse(i >= 0 ? raw.slice(i) : raw, ctx)
        if (!p.given) { loadMsg.textContent = 'That does not look like a reading list link.'; return }
        S = { ...specOf(p) }
        loadMsg.textContent = p.ignored.length ? `Loaded. Left out: ${p.ignored.join('; ')}.` : 'Loaded.'
        loadIn.value = ''
        syncInputs(); paint()
    }
    const clear = h('button', { type: 'button', class: 'rl-btn sm', onclick: () => { S = { ...NOTHING }; syncInputs(); paint() } }, 'Clear the list')
    const previewBox = h('div', { class: 'mk-preview' })

    let last = ''
    const sync = () => {
        const f = fragment()
        const link = opts.site + f
        out.value = link
        open.setAttribute('href', `index.html${f}`)
        facts.textContent = total() ? `${total()} article${total() === 1 ? '' : 's'} · ${link.length} characters` : 'Choose articles to make a link.'
        copy.disabled = !total()
        open.toggleAttribute('aria-disabled', !total())
        if (f !== last) { last = f; history.replaceState(null, '', f === '#' ? location.pathname + location.search : f) }
        const p = parse(f, ctx)
        const note = h('p', { class: 'rl-persona' }, `In the recipient’s browser this also becomes a persona, “${personaName(p)}”, which they can keep or remove. This preview does not touch yours.`)
        previewBox.replaceChildren(total() ? renderList(p, { root: opts.root, price, money, preview: true, afterHeader: note })
            : h('p', { class: 'mk-empty' }, 'The list will appear here as the recipient will see it.'))
    }
    const paint = () => {
        for (const e of live) {
            const r = rows.get(e.n)
            const inRead = S.read.includes(e.n), inLook = S.look.includes(e.n)
            r.read.setAttribute('aria-pressed', String(inRead)); r.look.setAttribute('aria-pressed', String(inLook))
            const full = total() >= LIMITS.list && !inRead && !inLook
            r.read.disabled = full; r.look.disabled = full
            r.li.classList.toggle('picked', inRead || inLook)
        }
        paintOrder(readBox); paintOrder(lookBox)
        for (const cb of follows.querySelectorAll('input')) cb.checked = S.follow.includes(cb.value)
        sync()
    }
    const syncInputs = () => {
        inFrom.value = S.from; inTo.value = S.to; inNote.value = S.note; inEmail.value = S.email
        noteCount.textContent = `${inNote.value.length} of ${LIMITS.note}`
        for (const k of Object.keys(problems)) problems[k] = ''
        msg.textContent = ''
    }

    // ---------------------------------------------------------------- the page
    const card = (title, ...kids) => h('section', { class: 'mk-card' }, h('h2', {}, title), ...kids)
    mount.replaceChildren(h('div', { class: 'mk' },
        h('div', { class: 'mk-main' },
            card('1. Who it is for',
                h('div', { class: 'mk-two' }, field('From', inFrom), field('To', inTo)),
                field('A note, one sentence (optional)', inNote, noteCount),
                field('Your email, for a Reply button (optional)', inEmail),
                msg),
            card('2. Choose the articles', h('div', { class: 'mk-filters' }, q, topic, persona), shownCount, pickList),
            card('3. Put them in order',
                h('h3', { class: 'rl-h' }, readBox.label), readBox.ol,
                h('h3', { class: 'rl-h' }, lookBox.label), lookBox.ol,
                h('p', { class: 'mk-hint' }, 'Drag to reorder, or use the arrows.')),
            card('4. What to follow (optional)', follows)),
        h('aside', { class: 'mk-side' },
            card('The link', out, h('p', { class: 'rl-actions' }, copy, open), facts,
                h('details', { class: 'mk-details' }, h('summary', {}, 'Edit an existing link'), h('p', { class: 'rl-actions' }, loadIn, h('button', { type: 'button', class: 'rl-btn', onclick: load }, 'Load')), loadMsg),
                h('p', {}, clear)),
            card('Preview, as the recipient sees it', previewBox))))
    noteCount.textContent = `${inNote.value.length} of ${LIMITS.note}`
    filter()
    paint()
    window.addEventListener('hashchange', () => { if (location.hash !== (last === '#' ? '' : last)) { fromFragment(); syncInputs(); paint() } })
}
