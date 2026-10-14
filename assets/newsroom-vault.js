/**
 * newsroom-vault.js: everything newsroom.sgit.ai does with vaults, in one module of its own, on top of the
 * vault library that runs dev.vault.sgraph.ai (assets/vendor/sg-vault/v0.2.3, pinned and unedited) and the
 * one local extension (assets/vendor/sg-vault/local/sg-vault--create-with-id.js).
 *
 * The rule, from https://sgit.ai/docs/vault/vault-from-javascript.html: one code base writes vaults. This file
 * writes none of the format; it calls the library and adds what the newsroom needs around it:
 *
 *   createVault, createVaultWithId, openVault      the library's create, createWithId and open, with the key prefix
 *                                                   stripped on the way in and this device's clone branch passed
 *   ensureLoaded, writeFile, publish               the tested helpers from the sgit.ai page, verbatim: load a folder
 *                                                   before writing into it, every write is one commit, publish with
 *                                                   compare-and-swap and merge on ECAS, never push()
 *   readText                                       a file as text, loading its folder first
 *   createAccount, unlock, addDoor, writeNote      the design: a door vault (derived id and passphrase) holds the
 *                                                   master vault's key; the master holds the reader vault's key and
 *                                                   the list of doors; every door records where it came from
 *   createLane, openLane, sendToLane, readKeyOf    the lane: a vault of its own for what the reader sends the
 *                                                   newsroom, its key kept in the master, its read key handed over
 *
 * The library's globals (SGSend, SGVault, SGVaultCrypto) must be loaded first, as plain scripts, in the order
 * VENDOR.md gives; this module reaches them as bare identifiers, which works in a page and in Node (vm.runInThisContext).
 *
 * Keys: a vault key is "<passphrase>:<vault id>" inside the library. A door's passphrase is 64 hex characters, so its
 * bare key has exactly the shape of a read key; it is passed bare to the library, which does not classify, and it
 * carries the sgit_private_vault_ prefix wherever it leaves the page (a file in a vault, the screen, the CLI).
 * Nothing in this module logs or stores a key.
 *
 * @module newsroom-vault
 */

function libs() {
    try { return { SGSend, SGVault, SGVaultCrypto } }                                  // global lexical bindings, as the page loads them
    catch (e) { throw new Error('The vault library is not loaded: the twelve scripts of assets/vendor/sg-vault/v0.2.3 and the local extension must load before this module.') }
}

// ------------------------------------------------------------ keys and names
const PREFIX = 'sgit_private_' + 'vault_'                                             // split so the tree holds no key-shaped literal
export const vaultKeyString = (passphrase, vaultId) => PREFIX + passphrase + ':' + vaultId
export const stripKey = key => libs().SGVaultCrypto.stripKeyPrefix(key)
export const keyParts = key => libs().SGVaultCrypto.parseVaultKey(stripKey(key))
/** An open vault's key in the form that leaves the page: prefixed, so sgit and a reader know what it is. */
export const prefixedKey = vault => { const k = vault.getVaultKey(), i = k.lastIndexOf(':'); return vaultKeyString(k.slice(0, i), k.slice(i + 1)) }

/** 24 characters of [a-z0-9], as sgit init makes, by rejection sampling (from the sgit.ai page). */
export function randomPassphrase(n = 24) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789', out = []
    while (out.length < n) {                             // rejection sampling: no modulo bias
        for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 252 && out.length < n) out.push(abc[b % 36])
    }
    return out.join('')
}

/** This device's clone branch, made once and kept in local storage; in memory where there is no storage. */
let memBranch = null
export function deviceBranch() {
    const KEY = 'sgit.device-branch'
    try { const v = localStorage.getItem(KEY); if (v) return v } catch (e) { /* no storage */ }
    if (!memBranch) memBranch = 'nr-' + crypto.randomUUID().slice(0, 8)
    try { localStorage.setItem(KEY, memBranch) } catch (e) { /* fine */ }
    return memBranch
}

/** The HTTP client: endpoint and, for writes, the access token (sent as x-sgraph-access-token and nothing else). */
export function client({ endpoint, token }) { return new (libs().SGSend)({ endpoint, token: token || '' }) }

// ------------------------------------------------------------ the five actions
export async function createVault(sgSend, { name, description, passphrase } = {}) {
    return libs().SGVault.create(sgSend, passphrase || randomPassphrase(), { name, description })
}

/** A vault at a known id (a door): the local extension, until the library takes create(…, { vaultId }). */
export async function createVaultWithId(sgSend, passphrase, vaultId, { name, description, cloneBranch } = {}) {
    const { SGVault } = libs()
    if (typeof SGVault.createWithId !== 'function') throw new Error('SGVault.createWithId is missing: load assets/vendor/sg-vault/local/sg-vault--create-with-id.js')
    return SGVault.createWithId(sgSend, stripKey(passphrase), vaultId, { name, description, cloneBranch: cloneBranch || deviceBranch() })
}

/** Open with a vault key, prefixed or bare, on this device's clone branch. A missing vault throws with code ENOVAULT. */
export async function openVault(sgSend, key, { cloneBranch } = {}) {
    try { return await libs().SGVault.open(sgSend, stripKey(key), { cloneBranch: cloneBranch || deviceBranch() }) }
    catch (e) { if (/HEAD ref missing/.test(String(e && e.message))) { e.code = 'ENOVAULT' } throw e }
}

/** Load every folder on the path (from the sgit.ai page). */
export async function ensureLoaded(vault, folder) {          // load every folder on the path
  let path = ''
  for (const part of folder.split('/').filter(Boolean)) {
    path += '/' + part
    if (vault.needsLoading(path)) await vault.loadSubTreeOnDemand(path)
  }
}

/** Write one file as one commit, creating folders as needed (from the sgit.ai page). */
export async function writeFile(vault, folder, name, data) {
  await ensureLoaded(vault, folder)                       // REQUIRED, see the warning below
  let path = ''
  for (const part of folder.split('/').filter(Boolean)) { // create missing folders
    path += '/' + part
    if (!vault.listFolder(path)) await vault.createFolder(path)
  }
  const bytes  = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const exists = (vault.listFolder(folder) || []).some(e => e.name === name && e.type === 'file')
  return exists ? vault.updateFile(folder, name, bytes) : vault.addFile(folder, name, bytes)
}

/** Publish with compare-and-swap; on ECAS merge and retry; never push() (from the sgit.ai page). */
export async function publish(vault) {
  if (vault._refManager.lastRawRef(vault._refFileId) === undefined)
    await vault.getBehindCount()               // only if never read: arms the compare-and-swap
  try { await vault.pushIfMatch(); return }
  catch (e) { if (e.code !== 'ECAS') throw e } // somebody else published first
  const theirs = await vault._refManager.readRef(vault._refFileId)
  const r = await vault.merge(theirs, { publish: false })   // fast-forward or three-way, file level
  if (r.conflicts.length) throw new Error('conflicts: ' + r.conflicts.join(', '))
  await vault.pushIfMatch()
}

/** A file as text; null when it is not there. */
export async function readText(vault, filePath) {
    const parts = filePath.split('/').filter(Boolean), name = parts.pop(), folder = '/' + parts.join('/')
    await ensureLoaded(vault, folder)
    const listed = vault.listFolder(folder) || []
    if (!listed.some(e => e.name === name && e.type === 'file')) return null
    return new TextDecoder().decode(await vault.getFile(folder, name))
}
export async function readJson(vault, filePath) { const t = await readText(vault, filePath); return t == null ? null : JSON.parse(t) }
export async function listFiles(vault, folder = '/') { await ensureLoaded(vault, folder); return (vault.listFolder(folder) || []).map(e => e.name + (e.type === 'folder' ? '/' : '')) }

// ------------------------------------------------------------ the account: door, master, reader
export const DOOR = { key: 'master-key.json', record: 'door.json' }
export const MASTER = { reader: 'reader.json', doors: 'doors.json', lane: 'lane.json' }

const now = () => new Date().toISOString()
const doorRecord = (door, record) => ({
    v: 1, kind: record.kind || 'passkey', provider: record.provider || '', path: record.path || '', credential_id: record.credential_id || '',
    device: record.device || '', created: now(), vault_id: door.vaultId,
})

/**
 * First device: the door (at its derived address), the master and the reader vault, as three real vaults.
 *   door   = { passphrase, vaultId } from doorFrom(bytes)
 *   record = { kind, provider, path, credential_id, device } — where this door came from
 * Returns { door, master, reader } as open vault objects, and the records written.
 */
export async function createAccount({ sgSend, door, record = {}, cloneBranch, names = {} }) {
    const master = await createVault(sgSend, { name: names.master || 'master' })
    const reader = await createVault(sgSend, { name: names.reader || 'reader' })
    const doorVault = await createVaultWithId(sgSend, door.passphrase, door.vaultId, { name: names.door || 'door', cloneBranch })
    const rec = doorRecord(door, record)
    await writeFile(doorVault, '/', DOOR.key, JSON.stringify({ v: 1, master: prefixedKey(master) }, null, 1))
    await writeFile(doorVault, '/', DOOR.record, JSON.stringify(rec, null, 1))
    await publish(doorVault)
    const doors = { v: 1, doors: [{ ...rec, vault_key: vaultKeyString(door.passphrase, door.vaultId) }] }
    await writeFile(master, '/', MASTER.reader, JSON.stringify({ v: 1, reader: prefixedKey(reader) }, null, 1))
    await writeFile(master, '/', MASTER.doors, JSON.stringify(doors, null, 1))
    await publish(master)
    await writeFile(reader, '/', 'README.md', '# A reader vault\n\nMade by newsroom.sgit.ai. Notes go in notes/.\n')
    await publish(reader)
    return { door: doorVault, master, reader, record: rec, doors: doors.doors }
}

/**
 * Unlock: open the door at the derived address, read the master's key, open the master, read the reader's key, open it.
 * Throws with code ENOVAULT when there is no door at the address: the caller says "no door here for this path yet".
 */
export async function unlock({ sgSend, door, cloneBranch }) {
    const doorVault = await openVault(sgSend, vaultKeyString(door.passphrase, door.vaultId), { cloneBranch })
    const key = await readJson(doorVault, '/' + DOOR.key)
    if (!key || !key.master) { const e = new Error('The door has no master key in it'); e.code = 'EDOOR'; throw e }
    const master = await openVault(sgSend, key.master, { cloneBranch })
    const readerKey = await readJson(master, '/' + MASTER.reader)
    const reader = readerKey && readerKey.reader ? await openVault(sgSend, readerKey.reader, { cloneBranch }) : null
    const doors = (await readJson(master, '/' + MASTER.doors)) || { doors: [] }
    const record = await readJson(doorVault, '/' + DOOR.record)
    return { door: doorVault, master, reader, doors: doors.doors, record }
}

/** While unlocked: a second path's door, holding the same master key, and the master's list updated. Nothing typed. */
export async function addDoor({ sgSend, master, door, record = {}, cloneBranch }) {
    const doorVault = await createVaultWithId(sgSend, door.passphrase, door.vaultId, { name: 'door', cloneBranch })
    const rec = doorRecord(door, record)
    await writeFile(doorVault, '/', DOOR.key, JSON.stringify({ v: 1, master: prefixedKey(master) }, null, 1))
    await writeFile(doorVault, '/', DOOR.record, JSON.stringify(rec, null, 1))
    await publish(doorVault)
    const doors = (await readJson(master, '/' + MASTER.doors)) || { v: 1, doors: [] }
    doors.doors.push({ ...rec, vault_key: vaultKeyString(door.passphrase, door.vaultId) })
    await writeFile(master, '/', MASTER.doors, JSON.stringify(doors, null, 1))
    await publish(master)
    return { door: doorVault, record: rec, doors: doors.doors }
}

/** A note in the reader vault: one commit, published. Returns the path. */
export async function writeNote(reader, text, name) {
    const file = name || `${new Date().toISOString().slice(0, 10)}.md`
    await writeFile(reader, '/notes', file, text)
    await publish(reader)
    return '/notes/' + file
}

// ------------------------------------------------------------ the lane: a vault of its own, from the reader to the newsroom
export const LANE = { folder: '/notes', readme: 'README.md' }
const README_LANE = '# A lane to the newsroom\n\nMade by newsroom.sgit.ai for one reader. Every file in notes/ is one note the reader chose to send: a tap at a piece (read later, not for me, more like this, liked, wrong, fix this, idea), the words they added, the phrase they had selected, the page and the persona. Nothing else of theirs is in this vault. The newsroom reads it with the read key the reader handed over; the write key stays in the reader\'s master vault.\n'

/**
 * A vault's public read key, in the form the sgit CLI clones with (sgit_public_read_<hex>:<id>): the library's own
 * derivation, exported. Reading is all it allows; the write key is a separate derivation it does not carry.
 */
export async function readKeyOf(vault) {
    const { passphrase, vaultId } = keyParts(vault.getVaultKey())
    const keys = await libs().SGVaultCrypto.deriveKeys(passphrase, vaultId)
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.readKey))
    return 'sgit_public_' + 'read_' + [...raw].map(b => b.toString(16).padStart(2, '0')).join('') + ':' + vaultId
}

/** The lane made, its key and read key recorded in the master. Returns { lane, record }. */
export async function createLane({ sgSend, master, device = '' }) {
    const lane = await createVault(sgSend, { name: 'lane to the newsroom', description: 'notes a reader of newsroom.sgit.ai chose to send; read with the read key' })
    const read = await readKeyOf(lane)
    await writeFile(lane, '/', LANE.readme, README_LANE)
    await publish(lane)
    const record = { v: 1, lane: prefixedKey(lane), read, created: now(), created_by: device }
    await writeFile(master, '/', MASTER.lane, JSON.stringify(record, null, 1))
    await publish(master)
    return { lane, record }
}

/** The lane opened from the master's record; null when the account has none yet. */
export async function openLane({ sgSend, master, cloneBranch }) {
    const record = await readJson(master, '/' + MASTER.lane)
    if (!record || !record.lane) return null
    return { lane: await openVault(sgSend, record.lane, { cloneBranch }), record }
}

/** Notes into the lane: one file each (notes/<id>.json, rewritten if sent again), one publish. Returns the paths. */
export async function sendToLane(lane, notes, device = '') {
    const paths = []
    for (const n of notes) {
        const name = `${n.id}.json`
        await writeFile(lane, LANE.folder, name, JSON.stringify({ ...n, device: n.device || device, sent_at: now() }, null, 1))
        paths.push(`${LANE.folder}/${name}`)
    }
    await publish(lane)
    return paths
}
