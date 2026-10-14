/**
 * vault-reader.js: read an encrypted sgit vault in the browser with a published read key.
 *
 * Vendored from sgit.ai's assets/vault-docs.js (the reader its docs have run on for months), as the
 * passkey article's rule asks: the vault code lives in this repository and is loaded from nowhere else.
 * Reduced to what the wire needs and turned into a module; the mechanism is unchanged:
 *
 *   ref id    = "ref-pid-muw-" + HMAC-SHA256(read key, "sg-vault-v1:file-id:ref:" + vault id)[:12]
 *   GET  {endpoint}/api/vault/read/{vault id}/bare/refs/{ref id}        the mutable HEAD pointer, no auth
 *   decrypt (AES-256-GCM under the read key; iv || ciphertext || tag) → { commit_id }
 *   GET  .../bare/data/{commit id}  → { tree_id, message_enc }
 *   walk the tree: entries carry name_enc, size_enc and a blob_id or tree_id, names decrypted with the same key
 *   GET  .../bare/data/{blob id}    → the file
 *
 * Three caches, as on sgit.ai: decrypted objects in memory for the page; ciphertext of content-addressed
 * objects (obj-cas-imm-*) in the Cache API for ever, since they cannot change; and the ref, which can, kept in
 * localStorage for ref_ttl_s (120 s by default), which is also the longest a new commit waits to be noticed.
 * The read key is public by design: it reads, and it cannot write (docs/credentials on sgit.ai).
 *
 * @module vault-reader
 */
const enc = new TextEncoder(), dec = new TextDecoder()
const hexToBytes = hex => Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16))
const bytesToHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('')
const b64ToBytes = b64 => { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out }

export class VaultReader {
    /** cfg: { endpoint, vault_id, read_key (64 hex, with or without its sgit_public_read_ prefix), ref_ttl_s } */
    constructor(cfg) {
        this.endpoint = String(cfg.endpoint).replace(/\/$/, '')
        this.vaultId = cfg.vault_id
        this.readKey = String(cfg.read_key).replace(/^sgit_(?:public|private)_read_|^sgit_rk1_/, '').split(':')[0]
        this.refTtlMs = (cfg.ref_ttl_s == null ? 120 : cfg.ref_ttl_s) * 1000
        this.mem = new Map()
        this.stats = { fetch: 0, cacheHit: 0, memHit: 0, bytesNet: 0, decrypts: 0 }
        this.store = cfg.store || (typeof localStorage !== 'undefined' ? localStorage : null)
    }

    async init() {
        const subtle = (globalThis.crypto || {}).subtle
        if (!subtle) throw new Error('Web Crypto is unavailable: this page needs https (or localhost), because the vault is decrypted in your browser.')
        const raw = hexToBytes(this.readKey)
        if (raw.length !== 32) throw new Error('The read key is not 32 bytes.')
        this.aesKey = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
        this.hmacKey = await subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        try { this.cache = typeof caches !== 'undefined' ? await caches.open('sgit-wire-v1') : null } catch (e) { this.cache = null }
        return this
    }

    async fileId(domain) { return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', this.hmacKey, enc.encode(domain)))).slice(0, 12) }
    async refFileId() { return 'ref-pid-muw-' + await this.fileId(`sg-vault-v1:file-id:ref:${this.vaultId}`) }

    async decrypt(bytes) {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), tagLength: 128 }, this.aesKey, bytes.slice(12))
        this.stats.decrypts++
        return new Uint8Array(pt)
    }
    async decryptText(bytes) { return dec.decode(await this.decrypt(bytes)) }
    async decryptB64(b64) { return b64 ? this.decryptText(b64ToBytes(b64)) : '' }

    /** Raw ciphertext for a vault path; immutable objects come from the Cache API when they are there. */
    async raw(vaultPath) {
        const url = `${this.endpoint}/api/vault/read/${this.vaultId}/${vaultPath}`
        const immutable = vaultPath.includes('-imm-')
        if (immutable && this.cache) {
            const hit = await this.cache.match(url)
            if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); this.stats.cacheHit++; return b }
        }
        const resp = await fetch(url, { cache: immutable ? 'default' : 'no-store' })
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${vaultPath}`)
        const buf = new Uint8Array(await resp.arrayBuffer())
        this.stats.fetch++; this.stats.bytesNet += buf.length
        if (immutable && this.cache) { try { await this.cache.put(url, new Response(buf)) } catch (e) { /* the cache is a convenience */ } }
        return buf
    }

    /** A decrypted object, memoised for the page. */
    async object(objId) {
        if (this.mem.has(objId)) { this.stats.memHit++; return this.mem.get(objId) }
        const plain = await this.decrypt(await this.raw(`bare/data/${objId}`))
        this.mem.set(objId, plain)
        return plain
    }
    async objectJson(objId) { return JSON.parse(dec.decode(await this.object(objId))) }

    refKey() { return `sgit-wire-ref:${this.vaultId}` }

    /** ref → commit. The ref is reused inside its freshness window; {force:true} always fetches it. */
    async open(opts = {}) {
        const refId = await this.refFileId()
        let refText = null, at = 0
        if (!opts.force && this.store) {
            try { const rec = JSON.parse(this.store.getItem(this.refKey()) || 'null'); if (rec && rec.text && Date.now() - rec.at < this.refTtlMs) { refText = rec.text; at = rec.at } } catch (e) { /* no window */ }
        }
        if (!refText) {
            refText = await this.decryptText(await this.raw(`bare/refs/${refId}`))
            at = Date.now()
            if (this.store) { try { this.store.setItem(this.refKey(), JSON.stringify({ text: refText, at })) } catch (e) { /* fine */ } }
        }
        const ref = JSON.parse(refText)
        this.head = ref.commit_id
        this.commit = await this.objectJson(ref.commit_id)
        this.message = await this.decryptB64(this.commit.message_enc)
        this.refCheckedAt = at
        this._files = null
        return { commitId: this.head, commit: this.commit, message: this.message, checkedAt: at }
    }

    /** Walk a tree. `under` names the top-level folders to descend into; other folders are listed, not walked. */
    async tree(treeId, prefix = '', out = {}, under = null) {
        const tree = await this.objectJson(treeId)
        await Promise.all((tree.entries || []).map(async e => {
            const name = await this.decryptB64(e.name_enc)
            const full = prefix ? `${prefix}/${name}` : name
            if (e.tree_id) { if (!under || prefix || under.includes(name)) await this.tree(e.tree_id, full, out, under); else out[full + '/'] = { tree_id: e.tree_id } }
            else out[full] = { blob_id: e.blob_id, size: parseInt(await this.decryptB64(e.size_enc) || '0', 10) }
        }))
        return out
    }

    /** path → { blob_id, size } for the open commit; memoised per commit id, since it cannot change. */
    async files(under = null) {
        if (!this.commit) await this.open()
        const tag = under ? under.slice().sort().join(',') : '*'
        if (this._files && this._filesTag === tag) return this._files
        const key = `sgit-wire-idx:${this.vaultId}:${this.head}:${tag}`
        if (this.store) { try { const c = this.store.getItem(key); if (c) { this._files = JSON.parse(c); this._filesTag = tag; return this._files } } catch (e) { /* walk it */ } }
        this._files = await this.tree(this.commit.tree_id, '', {}, under)
        this._filesTag = tag
        if (this.store) { try { this.store.setItem(key, JSON.stringify(this._files)) } catch (e) { /* fine */ } }
        return this._files
    }

    async readText(path) {
        const files = await this.files([path.split('/')[0]])
        if (!files[path]) throw new Error(`not in vault: ${path}`)
        return dec.decode(await this.object(files[path].blob_id))
    }
    async readJson(path) { return JSON.parse(await this.readText(path)) }
}

// ------------------------------------------------------------ markdown, as sgit.ai renders vault docs
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function inline(s) {
    s = esc(s)
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    s = s.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => /^https?:\/\//.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${text}</a>` : text)
    return s
}
/** Vault markdown to HTML: headings, fenced code, tables, lists, quotes, rules, paragraphs. Text is escaped; only http(s) links become links. */
export function markdown(src) {
    const lines = String(src).split('\n'), out = []
    let i = 0
    while (i < lines.length) {
        const ln = lines[i]
        if (/^```/.test(ln)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre class="md-code">${esc(buf.join('\n'))}</pre>`); continue }
        if (/^\s*$/.test(ln)) { i++; continue }
        if (/^#{1,6}\s/.test(ln)) { const lvl = Math.min(6, ln.match(/^#+/)[0].length + 1); const txt = ln.replace(/^#+\s*/, ''); out.push(`<h${lvl}>${inline(txt)}</h${lvl}>`); i++; continue }
        if (/^\|/.test(ln) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
            const head = ln.split('|').slice(1, -1).map(c => c.trim()); i += 2
            const rows = []
            while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim())); i++ }
            out.push(`<div class="tablewrap"><table><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table></div>`)
            continue
        }
        if (/^[-*]\s|^\d+\.\s/.test(ln)) {
            const ordered = /^\d+\.\s/.test(ln), items = []
            while (i < lines.length && /^([-*]\s|\d+\.\s)/.test(lines[i])) { items.push(lines[i].replace(/^([-*]\s|\d+\.\s)/, '')); i++ }
            const tag = ordered ? 'ol' : 'ul'
            out.push(`<${tag}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>`)
            continue
        }
        if (/^>\s?/.test(ln)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++ } out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`); continue }
        if (/^(---|\*\*\*)\s*$/.test(ln)) { out.push('<hr>'); i++; continue }
        const para = []
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|\||[-*]\s|\d+\.\s|>|---)/.test(lines[i])) { para.push(lines[i]); i++ }
        if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); else i++
    }
    return out.join('\n')
}
