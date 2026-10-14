/**
 * vault-mock.mjs: a mock of the SG/Send vault API in Node, for the tests.
 *
 * It behaves as dev.send.sgraph.ai does on the paths the vault library (assets/vendor/sg-vault) and
 * the sgit CLI use, as the sgit.ai page "Creating and writing a vault from JavaScript" describes them
 * and as the CLI's own Vault__API__In_Memory does:
 *
 *   GET    /api/vault/read/{vid}/{path}            the bytes, or 404. The CLI URL-encodes the path and the
 *                                                   library does not, so the path is decoded here.
 *   PUT    /api/vault/write/{vid}/{path}           token + write key; the first writer fixes SHA-256(write key)
 *   POST   /api/vault/batch/{vid}                  {operations:[{op, file_id, data, match}]}; op is read, write,
 *                                                   write-if-match or delete; data and match are base64; a write
 *                                                   needs the token and the write key; a compare-and-swap miss is
 *                                                   {"status":"conflict","current":<base64>} inside an HTTP 200,
 *                                                   and nothing after it in the batch is applied
 *   GET    /api/vault/list/{vid}?prefix=           {"files":[...]}
 *   GET    /api/vault/presigned/...                400, as a server without S3 answers
 *   DELETE /api/vault/delete/{vid}/{path}          token + write key
 *   GET    /api/vault/public-info/{vid}            404 until the vault has a file (the lab's address check)
 *   POST   /api/vault/append/{op}/{vid}            the append lanes, as https://sgit.ai/api/append-lanes.html documents
 *                                                   them (card 049): configure (access token + the vault's write key;
 *                                                   replaces the anchors), write (the append token in the body, no
 *                                                   headers, a blind {"ok": true}), list, fetch and mark-processed
 *                                                   (x-sgraph-vault-enum-key); a bad key or an unknown token is a 404
 *                                                   with an HTML page, a bad token pattern a 400; files are named
 *                                                   {epoch_ms:013d}_{24 hex}.enc and fetched while pending only
 *
 * CORS as measured on the real server: any origin, the two sgraph headers allowed, X-API-Key not allowed
 * (a preflight that asks for it is refused), so a browser client that sends X-API-Key fails here too.
 *
 * Keys never appear in its logs: it records methods, paths and statuses.
 *
 *   import { startMock } from './vault-mock.mjs'
 *   const mock = await startMock({ token: 'per-run-token' })
 *   ... mock.base, mock.store, mock.log, mock.vaults()
 *   await mock.close()
 */
import http from 'http'
import crypto from 'crypto'

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')
const json = (res, status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...extra }); res.end(JSON.stringify(obj)) }
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }
const ALLOWED_HEADERS = ['content-type', 'x-sgraph-access-token', 'x-sgraph-vault-write-key', 'x-sgraph-vault-enum-key']

export async function startMock(opts = {}) {
    const token = opts.token || ('mock-' + crypto.randomBytes(12).toString('hex'))
    const store = new Map()            // "vid/path" -> Buffer
    const owners = new Map()           // vid -> sha256(write key hex)
    const log = []                     // "METHOD /path -> status"
    const stats = { reads: 0, writes: 0, batches: 0, conflicts: 0, appends: 0 }
    const appendCfg = new Map()        // vid -> { anchors: Set(sha256 of token), enumHash }
    const lanes = new Map()            // `${vid}/${token}` -> { pending: Map(file_id -> {payload, received}), processed: Map }

    const body = req => new Promise((resolve, reject) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); req.on('error', reject) })
    const authorised = (req, vid, forWrite) => {
        if (!forWrite) return null
        if (req.headers['x-sgraph-access-token'] !== token) return [403, { detail: 'access token missing or wrong' }]
        const wk = req.headers['x-sgraph-vault-write-key']
        if (!wk || !/^[0-9a-f]{64}$/.test(String(wk))) return [403, { detail: 'x-sgraph-vault-write-key missing' }]
        const h = sha256(String(wk))
        if (owners.has(vid) && owners.get(vid) !== h) return [403, { detail: 'write key does not match the one that created this vault' }]
        if (!owners.has(vid)) owners.set(vid, h)
        return null
    }

    const handler = async (req, res) => {
        const u = new URL(req.url, 'http://mock')
        const m = req.method.toUpperCase()
        const done = (status, obj, extra) => { log.push(`${m} ${u.pathname} -> ${status}`); if (Buffer.isBuffer(obj)) { res.writeHead(status, { 'content-type': 'application/octet-stream', ...CORS, ...(extra || {}) }); res.end(obj) } else json(res, status, obj, extra) }
        try {
            if (m === 'OPTIONS') {
                const asked = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
                const refused = asked.filter(h => !ALLOWED_HEADERS.includes(h))
                if (refused.length) { log.push(`OPTIONS ${u.pathname} -> 403 (${refused.join(',')} not allowed)`); res.writeHead(403, CORS); res.end(); return }
                res.writeHead(204, { ...CORS, 'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS', 'access-control-allow-headers': ALLOWED_HEADERS.join(', '), 'access-control-max-age': '600' }); res.end(); return
            }
            const parts = u.pathname.split('/').filter(Boolean)        // api, vault, verb, vid, path...
            if (parts[0] !== 'api' || parts[1] !== 'vault') return done(404, { detail: 'not found' })
            const verb = parts[2], vid = parts[3]
            const rest = parts.slice(4).map(p => decodeURIComponent(p)).join('/')
            const path = decodeURIComponent(rest)                      // the CLI encodes "/" as %2F inside one segment
            if (verb === 'append' && m === 'POST') return await append(parts[3], parts[4])
            if (!/^[a-z0-9]{4,24}$/.test(vid || '')) return done(400, { detail: 'bad vault id' })

            if (verb === 'read' && m === 'GET') {
                stats.reads++
                const b = store.get(`${vid}/${path}`)
                return b ? done(200, b, { 'cache-control': path.includes('-imm-') ? 'public, max-age=31536000, immutable' : 'no-store' }) : done(404, { detail: 'not found' })
            }
            if (verb === 'write' && m === 'PUT') {
                const bad = authorised(req, vid, true); if (bad) return done(...bad)
                store.set(`${vid}/${path}`, await body(req)); stats.writes++
                return done(200, { status: 'ok', file_id: path })
            }
            if (verb === 'delete' && m === 'DELETE') {
                const bad = authorised(req, vid, true); if (bad) return done(...bad)
                const had = store.delete(`${vid}/${path}`)
                return done(200, { status: 'ok', deleted: had })
            }
            if (verb === 'batch' && m === 'POST') {
                stats.batches++
                let ops
                try { ops = JSON.parse((await body(req)).toString('utf8')).operations || [] } catch (e) { return done(400, { detail: 'bad json' }) }
                const anyWrite = ops.some(o => o.op !== 'read')
                const bad = authorised(req, vid, anyWrite); if (bad) return done(...bad)
                const results = []
                for (const o of ops) {
                    const key = `${vid}/${o.file_id}`
                    if (o.op === 'read') {
                        const b = store.get(key)
                        results.push(b ? { status: 'ok', file_id: o.file_id, data: b.toString('base64') } : { status: 'not_found', file_id: o.file_id })
                    } else if (o.op === 'delete') {
                        store.delete(key); results.push({ status: 'ok', file_id: o.file_id })
                    } else if (o.op === 'write-if-match') {
                        const current = store.get(key) || null
                        const expected = o.match ? Buffer.from(o.match, 'base64') : null
                        const same = (current === null && expected === null) || (current && expected && current.equals(expected))
                        if (!same) {
                            stats.conflicts++
                            results.push({ status: 'conflict', file_id: o.file_id, current: current ? current.toString('base64') : null, message: `CAS mismatch on ${o.file_id}` })
                            return done(200, { status: 'conflict', results })     // nothing after a miss is applied
                        }
                        store.set(key, Buffer.from(o.data, 'base64')); stats.writes++
                        results.push({ status: 'ok', file_id: o.file_id })
                    } else {
                        store.set(key, Buffer.from(o.data, 'base64')); stats.writes++
                        results.push({ status: 'ok', file_id: o.file_id })
                    }
                }
                return done(200, { status: 'ok', results })
            }
            if (verb === 'list' && m === 'GET') {
                const prefix = u.searchParams.get('prefix') || ''
                const files = [...store.keys()].filter(k => k.startsWith(`${vid}/${prefix}`)).map(k => k.slice(vid.length + 1))
                return done(200, { files, count: files.length })
            }
            if (verb === 'presigned') return done(400, { detail: 'presigned URLs are not available on this server' })
            if ((verb === 'public-info' || verb === 'health') && m === 'GET') {
                const n = [...store.keys()].filter(k => k.startsWith(`${vid}/`)).length
                return n ? done(200, { vault_id: vid, files: n }) : done(404, { detail: 'vault not found' })
            }
            if (verb === 'destroy') return done(405, { detail: 'not on the mock' })
            return done(404, { detail: 'not found' })
        } catch (e) {
            return done(500, { detail: String(e && e.message || e) })
        }

        async function append(op, avid) {
            const notFound = () => { log.push(`${m} ${u.pathname} -> 404`); res.writeHead(404, { 'content-type': 'text/html', ...CORS }); res.end('<!doctype html><title>Not Found</title><h1>Not Found</h1>') }
            if (!/^[a-z0-9]{4,24}$/.test(avid || '')) return done(400, { detail: 'bad vault id' })
            let b
            try { b = JSON.parse((await body(req)).toString('utf8') || '{}') } catch (e) { return done(400, { detail: 'bad json' }) }
            const cfg = appendCfg.get(avid)
            const lane = t => { const k = `${avid}/${t}`; if (!lanes.has(k)) lanes.set(k, { pending: new Map(), processed: new Map() }); return lanes.get(k) }
            if (op === 'configure') {
                if (req.headers['x-sgraph-access-token'] !== token) return done(401, { detail: 'access token required' })
                if (!owners.has(avid) || owners.get(avid) !== sha256(String(req.headers['x-sgraph-vault-write-key'] || ''))) return notFound()
                if (!Array.isArray(b.append_anchors) || typeof b.enum_key_hash !== 'string') return done(400, { detail: 'append_anchors and enum_key_hash are required' })
                appendCfg.set(avid, { anchors: new Set(b.append_anchors), enumHash: b.enum_key_hash })
                return done(200, { vault_id: avid, status: 'configured' })
            }
            if (op === 'write') {
                if (typeof b.append_token !== 'string' || typeof b.payload !== 'string') return done(400, { detail: 'append_token and payload are required' })
                if (!/^[0-9a-f]{16,128}$/.test(b.append_token)) return done(400, { detail: 'append_token: hex only' })
                if (!cfg || !cfg.anchors.has(sha256(b.append_token))) return notFound()
                if (b.payload.length > 5 * 1024 * 1024) return done(413, { detail: 'payload too large' })
                const l = lane(b.append_token)
                if (l.pending.size >= 1000) return done(507, { detail: 'lane full' })
                const id = `${String(Date.now()).padStart(13, '0')}_${crypto.randomBytes(12).toString('hex')}.enc`
                l.pending.set(id, { payload: b.payload, received: new Date().toISOString() }); stats.appends++
                return done(200, { ok: true })
            }
            if (!['list', 'fetch', 'mark-processed'].includes(op)) return notFound()
            const ek = req.headers['x-sgraph-vault-enum-key']
            if (!cfg || !ek || sha256(String(ek)) !== cfg.enumHash) return notFound()
            if (op === 'list') {
                const all = []
                for (const [k, l] of lanes) if (k.startsWith(avid + '/')) for (const [fid, f] of l.pending) all.push({ inbox: k.slice(avid.length + 1), file_id: fid, received: f.received, ...(b.include_content ? { content: f.payload } : {}) })
                all.sort((x, y) => x.file_id.localeCompare(y.file_id))
                const after = b.after_file_id ? all.filter(x => x.file_id > b.after_file_id) : all
                const size = Math.min(Number(b.limit) || 50, 200)
                return done(200, { entries: after.slice(0, size), truncated: after.length > size })
            }
            if (typeof b.inbox !== 'string' || !Array.isArray(b.file_ids)) return done(400, { detail: 'inbox and file_ids are required' })
            if (b.file_ids.length > 100) return done(400, { detail: 'at most 100 file ids' })
            const l = lanes.get(`${avid}/${b.inbox}`) || { pending: new Map(), processed: new Map() }
            if (op === 'fetch') return done(200, { files: b.file_ids.filter(id => l.pending.has(id)).map(id => ({ file_id: id, size: l.pending.get(id).payload.length, content: l.pending.get(id).payload })) })
            const moved = [], missing = []
            for (const id of b.file_ids) { if (l.pending.has(id)) { l.processed.set(id, l.pending.get(id)); l.pending.delete(id); moved.push(id) } else missing.push(id) }
            return done(200, { moved, missing })
        }
    }

    const server = http.createServer(handler)
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    return {
        token, store, owners, log, stats, port, server, handler, appendCfg, lanes,
        pending: vid => [...lanes].filter(([k]) => k.startsWith(vid + '/')).reduce((n, [, l]) => n + l.pending.size, 0),
        base: `http://127.0.0.1:${port}`,
        baseLocalhost: `http://localhost:${port}`,
        vaults: () => [...new Set([...store.keys()].map(k => k.split('/')[0]))],
        files: vid => [...store.keys()].filter(k => k.startsWith(vid + '/')).map(k => k.slice(vid.length + 1)),
        close: () => new Promise(r => server.close(r)),
    }
}
