/**
 * inbox.js: send to my vault from any browser (card 049, the brief in "Sixteen notes I did not want to lose").
 *
 * The reader's account gets an inbox: an append lane on the reader vault that any browser can write to and none can
 * read, and a key pair whose private half is kept in the master vault. The pane offers the link to it three ways, a
 * URL, the same as text, and a QR code, carrying only where to write and the key to encrypt with:
 *
 *     https://newsroom.sgit.ai/vault/send.html#sgi1.<reader vault id>.<append token>.<public key, SPKI, base64url>
 *
 * A browser holding the link (no passkey, no sign-in, an in-app web view, an old iPad) encrypts what it holds that the
 * vault does not have, its own device file in the format of assets/vault-pane/sync.js, to that key, and appends it to
 * the lane. The server answers {"ok": true} and nothing else; the sender learns nothing about the vault. The next time
 * the vault is opened with the passkey, the pane lists what is waiting, opens each message with the private key,
 * shows what it carries and from which browser, and on one press writes it into the reader vault as that browser's
 * device file, so the usual merge brings it in with the sending browser as the author.
 *
 * The cryptography is the one this site already uses to write to sgit.ai's subscribe lane (assets/subscribe.js) and
 * the sgit CLI's PKI: sgit's hybrid envelope v2, a fresh AES-256-GCM key wrapped with RSA-OAEP (SHA-256), here to a
 * 3072-bit key made in the reader's browser; the lane payload is base64 of the .enc text, as the append-lanes API
 * documents. A message that was changed on the way fails AES-GCM's check; one sealed to another key fails the unwrap;
 * one that opens but is not a newsroom inbox message for this key is refused by check().
 *
 * The four capabilities, as the append-lanes API splits them (https://sgit.ai/api/append-lanes.html):
 *   append token   in the link; writes to this lane, reads nothing
 *   enum key       in the master; lists, fetches and marks processed
 *   write key      the reader vault's own, derived from its key; configures (with the access key) and purges
 *   private key    in the master; decrypts; never sent to the server
 *
 * Everything above the line "the page" is pure or talks only to the vault server, and runs in Node for the tests.
 *
 * @module inbox
 */
export const ENDPOINT = 'https://dev.send.sgraph.ai'
export const KIND = 'sgit-newsroom-inbox/v1'
export const PREFIX = 'sgi1'
export const RSA = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
export const LIMITS = { payload: 5 * 1024 * 1024, batch: 100 }

const te = new TextEncoder(), td = new TextDecoder()
const subtle = () => globalThis.crypto.subtle
export const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
export const randomHex = n => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)))
export function b64(bytes) { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s) }
export function unb64(s) { const bin = atob(String(s)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out }
export const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64url = s => unb64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4))
export async function sha256hex(text) { return hex(await subtle().digest('SHA-256', typeof text === 'string' ? te.encode(text) : text)) }

/** The fingerprint of a public key, as assets/subscribe.js and the sgit CLI print it: sha256 of the DER, 16 hex. */
export async function fingerprint(spki) { return 'sha256:' + (await sha256hex(new Uint8Array(spki))).slice(0, 16) }

// ------------------------------------------------------------ the owner's record, kept in the master vault
/**
 * A new inbox for a reader vault: the key pair, the append token and the enum key. Nothing is sent anywhere here; the
 * caller configures the lane and writes the record into the master.
 */
export async function newInbox({ vault, endpoint = ENDPOINT, device = '' }) {
    const keys = await subtle().generateKey(RSA, true, ['encrypt', 'decrypt'])
    const spki = new Uint8Array(await subtle().exportKey('spki', keys.publicKey))
    const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', keys.privateKey))
    return { v: 1, vault, endpoint, token: randomHex(16), enum_key: randomHex(32), public: b64(spki), private: b64(pkcs8), fingerprint: await fingerprint(spki),
             created: new Date().toISOString(), created_by: device, rotated: [] }
}
/** The same inbox with a new append token: the old link stops being able to write once the lane is configured again. */
export function rotated(rec, device = '') {
    return { ...rec, token: randomHex(16), rotated: [...(rec.rotated || []), { at: new Date().toISOString(), by: device }] }
}
/** What configure is sent: the anchor (sha256 of the token, as text) and the hash of the enum key. */
export async function anchorsOf(rec) { return { append_anchors: [await sha256hex(rec.token)], enum_key_hash: await sha256hex(rec.enum_key) } }

// ------------------------------------------------------------ the link
/** The link as text: sgi1.<vault>.<token>.<public key>. */
export function linkCode(rec) { return `${PREFIX}.${rec.vault}.${rec.token}.${b64url(unb64(rec.public))}` }
export function linkUrl(rec, root) { return new URL(`vault/send.html#${linkCode(rec)}`, root).href }
/** A link from a URL or its text, wherever it is in what was pasted; null when there is none. */
export function parseLink(text) {
    const m = new RegExp(`${PREFIX}\\.([a-z0-9]{4,24})\\.([0-9a-f]{16,128})\\.([A-Za-z0-9_-]{200,3000})`).exec(String(text || ''))
    if (!m) return null
    let spki
    try { spki = unb64url(m[3]) } catch (e) { return null }
    return { vault: m[1], token: m[2], spki, code: m[0] }
}

// ------------------------------------------------------------ the envelope: sgit's hybrid v2
/** Seal text to a public key (SPKI bytes): { enc, payload }, payload being what the lane is sent. */
export async function seal(spki, text) {
    const pub = await subtle().importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
    const aes = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
    const raw = await subtle().exportKey('raw', aes)
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const c = await subtle().encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, te.encode(text))
    const w = await subtle().encrypt({ name: 'RSA-OAEP' }, pub, raw)
    const enc = btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }))
    return { enc, payload: btoa(enc) }
}
/** Open a lane payload with the private key (PKCS#8 bytes). Throws when it is not an envelope, not for this key, or changed. */
export async function unseal(pkcs8, payload) {
    let env
    try { env = JSON.parse(atob(atob(String(payload)))) } catch (e) { throw new Error('not an envelope') }
    if (!env || env.v !== 2 || !env.w || !env.i || !env.c) throw new Error('not an envelope')
    const priv = await subtle().importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
    let raw
    try { raw = await subtle().decrypt({ name: 'RSA-OAEP' }, priv, unb64(env.w)) } catch (e) { throw new Error('not sealed to this inbox’s key') }
    const aes = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt'])
    try { return td.decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(env.i), tagLength: 128 }, aes, unb64(env.c))) }
    catch (e) { throw new Error('changed on the way: the ciphertext does not check') }
}

// ------------------------------------------------------------ the message
/** The message a browser sends: its device file, addressed to the key's fingerprint. */
export function message(file, to, sentAt = new Date().toISOString()) { return { kind: KIND, to, sent_at: sentAt, file } }

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x)
const ID = /^[A-Za-z0-9_.:-]{1,80}$/, DEVICE = /^[A-Za-z0-9_-]{1,64}$/       // a device id becomes a file name in the reader vault
/** Why a message opened with the key is not taken in: a list of reasons, empty when it is a newsroom inbox message for `fp`. */
export function problems(msg, fp) {
    const out = []
    if (!isObj(msg)) return ['not a message']
    if (msg.kind !== KIND) out.push(`not a newsroom inbox message (${String(msg.kind || 'no kind').slice(0, 40)})`)
    if (msg.to !== fp) out.push('addressed to another key')
    const f = msg.file
    if (!isObj(f) || f.v !== 1) { out.push('no device file in it'); return out }
    if (!isObj(f.device) || !DEVICE.test(String(f.device.id || ''))) out.push('the sending browser has no id it can be filed under')
    for (const k of ['reads', 'topups', 'personas', 'notes']) if (f[k] != null && !Array.isArray(f[k])) out.push(`${k} is not a list`)
    for (const k of ['reads', 'notes']) if (Array.isArray(f[k]) && f[k].some(x => !isObj(x) || !ID.test(String(x.id || '')))) out.push(`a record in ${k} has no id`)
    if (f.wire != null && (!isObj(f.wire) || (f.wire.seen != null && !isObj(f.wire.seen)))) out.push('the wire record is not an object')
    if (Array.isArray(f.notes) && f.notes.some(n => isObj(n) && n.device && f.device && n.device !== f.device.id)) out.push('a note claims another browser')
    return out
}
/** What a message carries, in counts: { reads, topups, notes, seen }. */
export function carried(file) {
    const f = file || {}
    return { reads: (f.reads || []).length, topups: (f.topups || []).length, notes: (f.notes || []).length, seen: Object.keys((f.wire && f.wire.seen) || {}).length }
}

// ------------------------------------------------------------ the vault server's append routes
async function call(endpoint, op, vault, body, headers = {}) {
    const r = await fetch(`${endpoint}/api/vault/append/${op}/${vault}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    let j = null; try { j = await r.json() } catch (e) { j = null }
    if (!r.ok || !j) { const e = new Error(`the vault server answered ${r.status} to ${op}${r.status === 404 ? ' (a wrong key, or a lane that is not there)' : ''}`); e.status = r.status; throw e }
    return j
}
/** Configure the reader vault's lane: needs the vault's write key and the access key. Replaces the anchor list. */
export async function configure(rec, { writeKey, accessToken }) {
    return call(rec.endpoint || ENDPOINT, 'configure', rec.vault, await anchorsOf(rec), { 'x-sgraph-vault-write-key': writeKey, 'x-sgraph-access-token': accessToken })
}
/** Append a payload with the token from a link. Blind: {"ok": true}. */
export async function append(link, payload, endpoint = ENDPOINT) {
    if (String(payload).length > LIMITS.payload) throw new Error('too large for one message (5 MB)')
    const j = await call(endpoint, 'write', link.vault, { append_token: link.token, payload })
    if (j.ok !== true) throw new Error('the vault server did not take it')
    return j
}
/** Every pending file in the lane, metadata only: [{ inbox, file_id, received }]. */
export async function list(rec) {
    const out = []
    let after = null
    for (let page = 0; page < 50; page++) {
        const j = await call(rec.endpoint || ENDPOINT, 'list', rec.vault, after ? { include_content: false, after_file_id: after } : { include_content: false }, { 'x-sgraph-vault-enum-key': rec.enum_key })
        const entries = j.entries || []
        out.push(...entries)
        if (!j.truncated || !entries.length) break
        after = entries[entries.length - 1].file_id
    }
    return out
}
/** The content of pending files of one lane (named by its token, as list returns it), in batches of 100. */
export async function fetchFiles(rec, inbox, ids) {
    const files = []
    for (let i = 0; i < ids.length; i += LIMITS.batch) {
        const j = await call(rec.endpoint || ENDPOINT, 'fetch', rec.vault, { inbox, file_ids: ids.slice(i, i + LIMITS.batch) }, { 'x-sgraph-vault-enum-key': rec.enum_key })
        files.push(...(j.files || []))
    }
    return files
}
export async function markProcessed(rec, inbox, ids) {
    const moved = [], missing = []
    for (let i = 0; i < ids.length; i += LIMITS.batch) {
        const j = await call(rec.endpoint || ENDPOINT, 'mark-processed', rec.vault, { inbox, file_ids: ids.slice(i, i + LIMITS.batch) }, { 'x-sgraph-vault-enum-key': rec.enum_key })
        moved.push(...(j.moved || [])); missing.push(...(j.missing || []))
    }
    return { moved, missing }
}

/**
 * Everything waiting in the lane, opened: [{ inbox, file_id, received, msg, problems }]. A file that will not open is
 * listed with the reason, so the pane can show it and offer to discard it; nothing is merged from here.
 */
export async function drain(rec) {
    const entries = await list(rec)
    const pkcs8 = unb64(rec.private)
    const byLane = new Map()
    for (const e of entries) { if (!byLane.has(e.inbox)) byLane.set(e.inbox, []); byLane.get(e.inbox).push(e) }
    const out = []
    for (const [inbox, es] of byLane) {
        const files = await fetchFiles(rec, inbox, es.map(e => e.file_id))
        const content = new Map(files.map(f => [f.file_id, f.content]))
        for (const e of es) {
            const item = { inbox, file_id: e.file_id, received: e.received || null, msg: null, problems: [] }
            const c = content.get(e.file_id)
            if (c == null) item.problems.push('the server did not return it')
            else {
                try { item.msg = JSON.parse(await unseal(pkcs8, c)); item.problems = problems(item.msg, rec.fingerprint) }
                catch (err) { item.problems.push(String(err && err.message || err)) }
            }
            out.push(item)
        }
    }
    return out.sort((a, b) => String(a.file_id).localeCompare(String(b.file_id)))
}

// ------------------------------------------------------------ the QR code
/** The link as a QR code, an SVG string: dark modules as one path, on white, with the quiet zone. */
export async function qrSvg(text, { cell = 3, margin = 4, label = 'QR code of the link' } = {}) {
    const { default: qrcode } = await import('../vendor/qrcode-generator/2.0.4/qrcode.mjs')
    const q = qrcode(0, 'L'); q.addData(String(text), 'Byte'); q.make()
    const n = q.getModuleCount(), size = (n + margin * 2) * cell
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {                 // one rectangle per run of dark modules in a row
        if (!q.isDark(r, c)) continue
        let k = c; while (k + 1 < n && q.isDark(r, k + 1)) k++
        const w = (k - c + 1) * cell
        d += `M${(c + margin) * cell} ${(r + margin) * cell}h${w}v${cell}h-${w}z`
        c = k
    }
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`, modules: n, size }
}
