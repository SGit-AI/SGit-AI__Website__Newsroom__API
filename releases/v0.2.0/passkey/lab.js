/**
 * lab.js: the passkey lab. Proofs of concept for "The passkey opens the vault"
 * (articles/the-passkey-opens-the-vault.html), each one a card with a button and what came back.
 *
 *   0. what this browser can do           PublicKeyCredential, getClientCapabilities(), the platform authenticator
 *   1. make a passkey for this site       navigator.credentials.create() with rp.id = this host, a resident key,
 *                                         user verification, and the prf extension; shows prf.enabled and whether
 *                                         the passkey is synced (the BE and BS flags)
 *   2. touch it: the PRF bytes            navigator.credentials.get() with the fixed input; the 32 bytes that are
 *                                         the same on every device the passkey syncs to
 *   3. from the bytes, the door           HKDF to a seed, a passphrase and a vault id, exactly as the article's
 *                                         derivation says; then sgit's own derivation of the read and write keys
 *                                         (PBKDF2-HMAC-SHA256, 600,000 iterations each), timed
 *   4. a recovery code, the second door   26 characters of base32 in place of the PRF bytes
 *   5. test vectors                       the same derivation from a fixed input, compared with what sgit's own
 *                                         code produced in Python (vectors.json)
 *   6. real vaults                         with an access key the reader pastes (kept in memory only), through the
 *                                         vault library that runs dev.vault.sgraph.ai (vendored, assets/vendor/sg-vault)
 *                                         and assets/newsroom-vault.js: is there a door at the derived address; create
 *                                         the account (the door at its derived id, a random master, a random reader
 *                                         vault, every one an sgit vault); unlock through the door; add the recovery
 *                                         code as a second door while unlocked; write a note into the reader vault
 *                                         and read it back from a fresh open
 *
 * Nothing here touches the reading account. No key is stored anywhere: the access key lives in a variable until
 * the page is closed, and the derived keys are shown only behind a reveal. The page loads no third-party code;
 * every call to the vault server is listed as it happens.
 *
 * The derivation, written out (the article's steps 1 to 6, made exact):
 *   prf input        = SHA-256("newsroom.sgit.ai/door/v1")                      a public constant
 *   door seed        = HKDF-SHA256(ikm = prf bytes, salt = SHA-256("newsroom.sgit.ai"), info = "sgit/door/v1", 32 bytes)
 *   passphrase       = hex( HKDF-SHA256(ikm = seed, salt = empty, info = "sgit/door/v1/passphrase", 32 bytes) )
 *   vault id         = 8 characters of [a-z0-9] drawn from HKDF-SHA256(ikm = seed, salt = empty, info = "sgit/door/v1/id", 64 bytes),
 *                      a byte accepted only when it is below 252 (= 7 × 36), so no character is favoured
 *   vault key        = sgit_private_vault_ + passphrase + ":" + vault id              (sgit's format)
 *   read key         = PBKDF2-HMAC-SHA256(passphrase, "sg-vault-v1:" + vault id, 600000, 32 bytes)        (sgit)
 *   write key        = PBKDF2-HMAC-SHA256(passphrase, "sg-vault-v1:write:" + vault id, 600000, 32 bytes)  (sgit)
 *   recovery door    = the same, with the 16 bytes of the recovery code as the ikm
 *
 * @module passkey-lab
 */

import * as NV from '../assets/newsroom-vault.js'     // the newsroom's layer over the vendored vault library (card 6)

import * as DOOR from '../assets/door.js'
// The derivation lives in assets/door.js now, shared with the vault pane; everything it exports is re-exported here, so the
// test vectors and the tests read it from the lab as before.
export * from '../assets/door.js'
const { ALPHABET: _A, hex, unhex, sha256, concat, hkdf, pbkdf2, hmac, aesEncrypt, aesDecrypt, vaultIdFrom, doorFrom, sgitKeys, vaultKeyString, readKeyString,
        PRF_INPUT_TEXT, recoveryCode, recoveryBytes, randomVaultKey, flagsOf } = DOOR
const te = new TextEncoder(), td = new TextDecoder()

// ------------------------------------------------------------ the page
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
const row = (k, v, cls) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: `v ${cls || ''}` }, v))
const secret = (text, label) => {
    const span = h('span', { class: 'mono' }, '•'.repeat(Math.min(24, text.length)) + ` (${text.length} characters)`)
    let shown = false
    const btn = h('button', { type: 'button', class: 'btn sm', onclick: () => { shown = !shown; span.textContent = shown ? text : '•'.repeat(Math.min(24, text.length)) + ` (${text.length} characters)`; btn.textContent = shown ? 'Hide' : `Reveal ${label || ''}`.trim() } }, `Reveal ${label || ''}`.trim())
    const copy = h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied' } catch (e) { copy.textContent = 'Could not copy' } setTimeout(() => { copy.textContent = 'Copy' }, 1500) } }, 'Copy')
    return h('span', { class: 'secret' }, span, ' ', btn, ' ', copy)
}
const err = e => (e && e.name ? `${e.name}: ` : '') + String(e && e.message || e)

export async function lab(opts) {
    const $ = id => document.getElementById(id)
    const S = { cred: null, prf: null, door: null, keys: null, recovery: null, access: '', log: [] }
    const stored = (() => { try { return JSON.parse(localStorage.getItem('sgit.passkey.lab') || 'null') } catch (e) { return null } })()
    const remember = v => { try { localStorage.setItem('sgit.passkey.lab', JSON.stringify(v)) } catch (e) { /* fine */ } }

    // 0 ---------------------------------------------------------------- capabilities
    const out0 = $('poc0-out')
    const can = !!window.PublicKeyCredential
    const caps = can && PublicKeyCredential.getClientCapabilities ? await PublicKeyCredential.getClientCapabilities().catch(() => null) : null
    const uvpaa = can && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => null) : null
    out0.replaceChildren(
        row('Secure context', window.isSecureContext ? 'yes' : 'no: WebAuthn needs https, or localhost', window.isSecureContext ? 'ok' : 'bad'),
        row('WebAuthn (PublicKeyCredential)', can ? 'present' : 'missing', can ? 'ok' : 'bad'),
        row('Relying party id this page uses', location.hostname),
        row('A platform authenticator that verifies the user (Touch ID, Face ID, Windows Hello, a screen lock)', uvpaa == null ? 'unknown' : uvpaa ? 'available' : 'not available', uvpaa ? 'ok' : ''),
        row('getClientCapabilities()', caps ? Object.entries(caps).map(([k, v]) => `${k}: ${v}`).join(' · ') : 'not implemented in this browser (Chrome 133+, Safari 17.4+)'),
        row('PRF, as the browser reports it', caps && typeof caps['extension:prf'] === 'boolean' ? String(caps['extension:prf']) : 'the browser does not say (some report null here); the passkey will, when it is made (prf.enabled)'),
        stored ? row('A passkey from this lab, in this browser', `made ${stored.made.slice(0, 16).replace('T', ' ')}, credential ${stored.id.slice(0, 12)}…, PRF ${stored.prf ? 'on' : 'off'}`) : null,
    )

    // 1 ---------------------------------------------------------------- create
    const out1 = $('poc1-out'), ladder = $('poc1-ladder')
    $('poc1-go').addEventListener('click', async () => {
        out1.replaceChildren(h('p', { class: 'dim' }, 'Waiting for the browser’s passkey prompt…')); ladder.hidden = true
        try {
            const prfInput = await sha256(PRF_INPUT_TEXT)
            const userId = crypto.getRandomValues(new Uint8Array(16))
            const cred = await navigator.credentials.create({ publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: { id: location.hostname, name: 'SGit Newsroom (passkey lab)' },
                user: { id: userId, name: 'reader', displayName: 'A reader of the SGit Newsroom' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
                extensions: { prf: { eval: { first: prfInput } }, credProps: true },
                timeout: 120000,
            } })
            const ext = cred.getClientExtensionResults()
            const authData = cred.response.getAuthenticatorData ? cred.response.getAuthenticatorData() : null
            const flags = authData ? flagsOf(authData) : null
            const transports = cred.response.getTransports ? cred.response.getTransports() : []
            S.cred = { id: cred.id, rawId: cred.rawId, userId, prf: !!(ext.prf && ext.prf.enabled), flags, transports, attachment: cred.authenticatorAttachment }
            remember({ id: cred.id, userId: hex(userId), made: new Date().toISOString(), prf: S.cred.prf })
            out1.replaceChildren(
                row('Credential id', h('span', { class: 'mono' }, cred.id)),
                row('User handle (random, made by this page; it syncs with the passkey)', h('span', { class: 'mono' }, hex(userId))),
                row('Authenticator', `${cred.authenticatorAttachment || 'unknown attachment'}${transports.length ? ` · transports: ${transports.join(', ')}` : ''}`),
                row('Resident (discoverable) credential', ext.credProps && 'rk' in ext.credProps ? String(ext.credProps.rk) : 'required; the browser did not report it'),
                flags ? row('Synced?', `backup eligible ${flags.be ? 'yes' : 'no'} · backed up ${flags.bs ? 'yes' : 'no'}: ${flags.be ? 'this passkey can travel to other devices through its provider' : 'this passkey is bound to this device'}`, flags.be ? 'ok' : 'warn') : null,
                row('prf.enabled', String(S.cred.prf), S.cred.prf ? 'ok' : 'bad'),
                h('p', { class: 'dim' }, S.cred.prf ? 'The authenticator can produce the PRF bytes. Go to 2.' : 'No PRF bytes from this authenticator, so no door can be derived from it. The ladder below is what the page would offer.'),
            )
            ladder.hidden = S.cred.prf
        } catch (e) { out1.replaceChildren(h('p', { class: 'warn' }, err(e))) }
    })

    // 2 ---------------------------------------------------------------- get PRF
    const out2 = $('poc2-out')
    const prfText = $('poc2-input'); prfText.value = PRF_INPUT_TEXT
    $('poc2-go').addEventListener('click', async () => {
        out2.replaceChildren(h('p', { class: 'dim' }, 'Waiting for the gesture…'))
        try {
            const inputText = prfText.value.trim() || PRF_INPUT_TEXT
            const prfInput = await sha256(inputText)
            const a = await navigator.credentials.get({ publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: 'required',
                allowCredentials: [], extensions: { prf: { eval: { first: prfInput } } }, timeout: 120000,
            } })
            const ext = a.getClientExtensionResults()
            const flags = flagsOf(a.response.authenticatorData)
            if (!ext.prf || !ext.prf.results || !ext.prf.results.first) throw new Error('The authenticator signed, and returned no PRF bytes (prf.results.first is empty). This is the “Chrome’s own store” case in the article.')
            const bytes = new Uint8Array(ext.prf.results.first)
            const path = a.authenticatorAttachment || 'not reported'
            S.prf = { bytes, inputText, credId: a.id, userHandle: a.response.userHandle ? hex(a.response.userHandle) : '', path }
            // the fingerprint is a hash of the bytes, not a prefix of them: it is meant to be read out and compared
            const fp = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).slice(0, 8)
            out2.replaceChildren(
                row('PRF input (SHA-256 of the text; public)', h('span', { class: 'mono' }, hex(prfInput))),
                row('The 32 PRF bytes', secret(hex(bytes), 'the bytes')),
                row('Their fingerprint (SHA-256 of the bytes, first 8), to compare between devices', h('b', { class: 'mono big' }, fp)),
                row('Path', `${path}${path === 'platform' ? ': the provider on this device answered' : path === 'cross-platform' ? ': a phone by QR, or a security key, answered' : ''}`),
                row('Credential used', h('span', { class: 'mono' }, a.id)),
                row('User handle', h('span', { class: 'mono' }, S.prf.userHandle || 'none returned')),
                row('Flags', `user present ${flags.up} · verified ${flags.uv} · backup eligible ${flags.be} · backed up ${flags.bs}`),
                h('p', { class: 'dim' }, 'Open this page on another device where the same passkey is available (the same Google or Apple account, or the same hardware key), press the same button, and the fingerprint, the credential id and the user handle are the same, when the passkey answers by the same kind of path. By a different path (a phone over QR, instead of the provider on the device) the same passkey can give different bytes: a test on 12 October 2026 found exactly that, and the design gives each path its own door (the note linked below). Different input text gives different bytes from the same passkey.'),
            )
            $('poc2-compare').hidden = false
            $('poc2-mine').textContent = fp
            await derive()
        } catch (e) { out2.replaceChildren(h('p', { class: 'warn' }, err(e))) }
    })
    $('poc2-cmp-go').addEventListener('click', () => {
        const other = $('poc2-other').value.trim().toLowerCase(), mine = $('poc2-mine').textContent
        $('poc2-cmp-out').textContent = !other ? '' : other === mine ? 'The same: the two devices derived the same door.' : 'Different: another passkey, another input, another path (a phone over QR against the provider on the device), or a provider that does not sync this one.'
    })

    // 3 ---------------------------------------------------------------- derive
    const out3 = $('poc3-out')
    async function derive(ikm, label) {
        ikm = ikm || (S.prf && S.prf.bytes)
        if (!ikm) { out3.replaceChildren(h('p', { class: 'dim' }, 'No PRF bytes yet: do 2 first, or use the test vector in 5.')); return }
        out3.replaceChildren(h('p', { class: 'dim' }, 'Deriving: HKDF three times, then PBKDF2 twice at 600,000 iterations…'))
        const door = await doorFrom(ikm)
        const keys = await sgitKeys(door.passphrase, door.vaultId)
        S.door = door; S.keys = keys; S.doorFrom = label || 'the passkey'
        out3.replaceChildren(
            row('From', S.doorFrom),
            row('Door seed (HKDF of the bytes, salted with the site’s name)', secret(door.seed, 'the seed')),
            row('Door passphrase (64 hex characters)', secret(door.passphrase, 'the passphrase')),
            row('Door vault id (8 of a–z 0–9, rejection-sampled)', h('b', { class: 'mono big' }, door.vaultId)),
            row('The sgit vault key', secret(vaultKeyString(door.passphrase, door.vaultId), 'the key')),
            row('Read key (PBKDF2, 600,000 iterations)', h('span', {}, secret(keys.readHex, 'the read key'), ` ${keys.msRead} ms`)),
            row('Write key (PBKDF2, 600,000 iterations)', h('span', {}, secret(keys.writeHex, 'the write key'), ` ${keys.msWrite} ms`)),
            row('The published form of the read key', h('span', { class: 'mono' }, readKeyString(keys.readHex, door.vaultId))),
            row('Where sgit would keep this vault’s ref and branch index', h('span', { class: 'mono' }, `${keys.refId} · ${keys.indexId}`)),
            h('p', { class: 'dim' }, `Nothing above was stored. Open the page again on any device with the passkey and the same values come out; that is why the door's key lives nowhere. Two derivations took ${keys.msRead + keys.msWrite} ms on this device; a cold unlock needs up to six.`),
        )
        $('poc6').hidden = false
        $('poc6-id').textContent = door.vaultId
    }
    $('poc3-go').addEventListener('click', () => derive())

    // 4 ---------------------------------------------------------------- recovery code
    const out4 = $('poc4-out')
    $('poc4-go').addEventListener('click', async () => {
        const rc = recoveryCode()
        S.recovery = rc
        const door = await doorFrom(rc.bytes)
        out4.replaceChildren(
            row('Recovery code (shown once in the real flow; here as often as you like)', h('b', { class: 'mono big' }, rc.shown)),
            row('Its door’s vault id', h('b', { class: 'mono' }, door.vaultId)),
            row('Its door’s passphrase', secret(door.passphrase, 'the passphrase')),
            h('p', { class: 'dim' }, 'A different door to the same master: the real flow writes the master vault’s key into both. Type the code back below to see the same door come out.'),
        )
    })
    $('poc4-check').addEventListener('click', async () => {
        const b = recoveryBytes($('poc4-code').value)
        if (!b) { $('poc4-check-out').textContent = 'That is not 26 characters of base32.'; return }
        const door = await doorFrom(b)
        $('poc4-check-out').textContent = `That code opens door ${door.vaultId}.`
        if (!S.prf && $('poc4-use').checked) await derive(b, 'the recovery code')
    })

    // 5 ---------------------------------------------------------------- test vectors
    const out5 = $('poc5-out')
    try {
        const v = await fetch(opts.vectors, { cache: 'no-store' }).then(r => r.json())
        const ikm = await sha256(v.input_text)
        const door = await doorFrom(ikm)
        const keys = await sgitKeys(door.passphrase, door.vaultId)
        const plaintext = te.encode(v.door_record_plaintext)
        const iv = (await hmac(keys.read, v.door_record_plaintext)).slice(0, 12)         // sgit's encrypt_deterministic: iv = HMAC(key, plaintext)[:12]
        const ct = await aesEncrypt(keys.read, plaintext, iv)
        const objId = 'obj-cas-imm-' + hex(await sha256(ct)).slice(0, 12)
        const got = { prf_hex: hex(ikm), seed: door.seed, passphrase: door.passphrase, vault_id: door.vaultId, read_key: keys.readHex, write_key: keys.writeHex,
                      ref_file_id: keys.refId, branch_index_file_id: keys.indexId, door_record_ct_hex: hex(ct), door_record_object_id: objId }
        const rows = Object.keys(got).map(k => row(k, h('span', { class: `mono ${got[k] === v[k] ? 'ok' : 'bad'}` }, `${got[k] === v[k] ? '✓' : '✗'} ${String(got[k]).slice(0, 40)}${String(got[k]).length > 40 ? '…' : ''}`)))
        const all = Object.keys(got).every(k => got[k] === v[k])
        out5.replaceChildren(
            h('p', { class: all ? 'ok' : 'warn' }, all ? 'The browser and sgit agree on every value.' : 'A value differs: the browser and the command line would open different vaults.'),
            row('Fake PRF bytes = SHA-256 of', v.input_text), ...rows,
            h('p', { class: 'dim' }, `The expected values were made by admin/build/passkey_vectors.py with sgit-ai ${v.sgit_version}'s own Vault__Crypto for the read and write keys, the file ids and the deterministic encryption, and the HKDF steps written out in Python. ${v.note}`),
        )
        S.vector = { ikm, door, keys }
        $('poc5-use').hidden = false
    } catch (e) { out5.replaceChildren(h('p', { class: 'warn' }, `The test vectors could not be loaded: ${err(e)}`)) }
    $('poc5-use-go').addEventListener('click', () => S.vector && derive(S.vector.ikm, 'the test vector (not a real passkey)'))

    // 6 ---------------------------------------------------------------- real vaults, through the library
    const out6 = $('poc6-out'), log = $('poc6-log')
    const access = $('poc6-access'), server = $('poc6-server'), device = $('poc6-device')
    S.vaults = null                                                      // { door, master, reader, doors } once created or unlocked
    const enable = () => {
        $('poc6-create').disabled = !S.access
        $('poc6-add').disabled = !(S.access && S.vaults && S.vaults.master && S.recovery)
        $('poc6-write').disabled = !(S.access && S.vaults && S.vaults.reader)
    }
    access.addEventListener('input', () => { S.access = access.value.trim(); enable() })
    window.addEventListener('pagehide', () => { S.access = ''; access.value = '' })
    const say = (line, cls) => { log.prepend(h('li', { class: cls || '' }, `${new Date().toISOString().slice(11, 19)} ${line}`)); log.hidden = false }
    // every call the library makes to the chosen vault server is listed as it happens; nothing else is touched
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
        const u = String(input instanceof Request ? input.url : input), base = server.value.replace(/\/$/, '')
        if (!u.startsWith(base + '/')) return origFetch(input, init)
        const method = (init && init.method) || (input instanceof Request ? input.method : 'GET')
        const r = await origFetch(input, init)
        say(`${method} ${u.slice(base.length).replace(/\/obj-cas-imm-[0-9a-f]{12}/g, '/obj-cas-imm-…')} → ${r.status}`, r.ok || r.status === 404 ? 'ok' : 'warn')
        return r
    }
    const sgSend = () => NV.client({ endpoint: server.value.replace(/\/$/, ''), token: S.access })
    const need = () => { if (!S.door) throw new Error('Derive a door first (3, or the recovery code in 4, or the test vector in 5).') }
    const dim = t => h('p', { class: 'dim' }, t), warn = t => h('p', { class: 'warn' }, t)
    const vaultRow = (label, v) => row(label, h('span', {}, h('b', { class: 'mono' }, v.vaultId), ` · ${v.getStats().files} file(s), ${v.getStats().folders} folder(s) · for sgit clone: `, secret(NV.prefixedKey(v), 'the key')))
    const doorsRow = doors => row('Doors in the master', (doors || []).map(d => `${d.vault_id} (${d.kind}${d.path ? ', ' + d.path : ''}${d.device ? ', ' + d.device : ''})`).join(' · ') || 'none')
    const whenceText = r => r ? [r.kind, r.path || null, r.provider ? `transports ${r.provider}` : 'provider not recorded', r.device ? `device “${r.device}”` : null, String(r.created || '').slice(0, 10) || null].filter(Boolean).join(', ') : 'no record in it'
    const whence = () => ({
        kind: S.doorFrom === 'the recovery code' ? 'recovery' : /test vector/.test(S.doorFrom || '') ? 'test-vector' : 'passkey',
        provider: S.cred && S.cred.transports && S.cred.transports.length ? S.cred.transports.join('+') : '',   // the browser names transports, not the provider
        path: S.prf ? S.prf.path : '', credential_id: S.prf ? S.prf.credId : (S.cred ? S.cred.id : ''),
        device: device.value.trim(),
    })
    const noDoor = () => out6.replaceChildren(h('p', { class: 'dim', id: 'poc6-nodoor' }, `No door here for this path yet (${S.door.vaultId}). Create the account below; or, if you already have one through another path, unlock there and add this path as a door.`))

    $('poc6-check').addEventListener('click', async () => {
        try {
            need(); out6.replaceChildren(dim('Opening the door: two key derivations, then the branch index and the ref…'))
            const v = await NV.openVault(sgSend(), vaultKeyString(S.door.passphrase, S.door.vaultId))
            const rec = await NV.readJson(v, '/' + NV.DOOR.record)
            out6.replaceChildren(h('p', { class: 'ok' }, `A door exists at ${S.door.vaultId}: a real vault, opened with nothing but the derived key.`),
                vaultRow('The door', v), row('Where it came from', whenceText(rec)))
        } catch (e) { if (e.code === 'ENOVAULT') noDoor(); else out6.replaceChildren(warn(err(e))) }
    })
    $('poc6-create').addEventListener('click', async () => {
        try {
            need(); if (!S.access) throw new Error('Paste an access key first.')
            out6.replaceChildren(dim('Creating three vaults: six key derivations at 600,000 iterations each, three first commits, then the door and the master written and published…'))
            const t0 = performance.now()
            const a = await NV.createAccount({ sgSend: sgSend(), door: S.door, record: whence() })
            S.vaults = a; enable()
            out6.replaceChildren(h('p', { class: 'ok' }, `Three vaults exist, each one an sgit vault (${Math.round(performance.now() - t0)} ms).`),
                vaultRow('The door, at its derived address', a.door),
                row('In the door', `${NV.DOOR.key} (the master’s key) and ${NV.DOOR.record} (${whenceText(a.record)})`),
                vaultRow('The master, made at random', a.master),
                row('In the master', `${NV.MASTER.reader} (the reader vault’s key) and ${NV.MASTER.doors} (1 door)`),
                vaultRow('The reader vault, made at random', a.reader),
                dim('Nothing was stored on this device. Press “Unlock” to do what a new device would do, add the recovery code as a second door, or write a note.'))
        } catch (e) { if (e.code === 'EEXISTS') out6.replaceChildren(warn(`A door already exists at ${S.door.vaultId}: unlock through it instead.`)); else out6.replaceChildren(warn(err(e))) }
    })
    $('poc6-unlock').addEventListener('click', async () => {
        try {
            need(); out6.replaceChildren(dim('Unlocking: the door, then the master, then the reader vault, six key derivations…'))
            const t0 = performance.now()
            const u = await NV.unlock({ sgSend: sgSend(), door: S.door })
            S.vaults = u; enable()
            const notes = u.reader ? await NV.listFiles(u.reader, '/notes').catch(() => []) : []
            out6.replaceChildren(h('p', { class: 'ok' }, `Unlocked in ${Math.round(performance.now() - t0)} ms, with nothing stored on this device: the door gave the master, the master gave the reader vault.`),
                vaultRow('The door', u.door),
                row('Where it came from', whenceText(u.record)),
                vaultRow('The master', u.master), doorsRow(u.doors),
                u.reader ? vaultRow('The reader vault', u.reader) : row('The reader vault', 'none recorded in the master'),
                row('Notes in the reader vault', notes.length ? notes.join(', ') : 'none yet'))
        } catch (e) { if (e.code === 'ENOVAULT') noDoor(); else out6.replaceChildren(warn(err(e))) }
    })
    $('poc6-add').addEventListener('click', async () => {
        try {
            if (!S.vaults || !S.vaults.master) throw new Error('Create or unlock first.')
            if (!S.recovery) throw new Error('Make a recovery code in 4 first.')
            out6.replaceChildren(dim('Adding a door: the recovery code’s bytes derive a second address; the master’s key is written into it; the master’s list grows…'))
            const d2 = await doorFrom(S.recovery.bytes)
            const r = await NV.addDoor({ sgSend: sgSend(), master: S.vaults.master, door: d2, record: { kind: 'recovery', device: device.value.trim() } })
            S.vaults.doors = r.doors
            out6.replaceChildren(h('p', { class: 'ok' }, `A second door, ${d2.vaultId}, holds the same master key. Nothing was typed or pasted; the key moved inside this page.`),
                vaultRow('The recovery door', r.door), doorsRow(r.doors),
                dim('Typing the recovery code on a device with no passkey derives this door and opens the same master.'))
        } catch (e) { if (e.code === 'EEXISTS') out6.replaceChildren(warn('That door already exists.')); else out6.replaceChildren(warn(err(e))) }
    })
    $('poc6-write').addEventListener('click', async () => {
        try {
            if (!S.vaults || !S.vaults.reader) throw new Error('Create or unlock first.')
            const text = ($('poc6-note').value.trim() || `A note written at ${new Date().toISOString()}`) + '\n'
            out6.replaceChildren(dim('Writing one commit into the reader vault, publishing it, then opening the vault again to read it back…'))
            const p = await NV.writeNote(S.vaults.reader, text)
            const again = await NV.openVault(sgSend(), NV.prefixedKey(S.vaults.reader), { cloneBranch: 'nr-readback' })
            const back = await NV.readText(again, p)
            out6.replaceChildren(h('p', { class: 'ok' }, 'Written as one commit, published with compare-and-swap, and read back from a fresh open of the vault.'),
                row('Path in the reader vault', h('span', { class: 'mono' }, p)), row('Read back', h('span', { id: 'poc6-readback' }, (back || '').trim())),
                vaultRow('The reader vault now', again))
        } catch (e) { out6.replaceChildren(warn(err(e))) }
    })
    document.documentElement.setAttribute('data-lab', 'ready')
}
