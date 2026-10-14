#!/usr/bin/env node
/* test_vault.mjs: real vaults from the newsroom's code, against a mock of the vault API and against the sgit CLI.
 *
 *   node admin/build/test_vault.mjs
 *
 * Loads the vendored vault library the way the page does (vm.runInThisContext, one realm, in VENDOR.md's order),
 * the local extension and assets/newsroom-vault.js, then, against admin/build/vault-mock.mjs:
 *   - the vendored files hash to what VENDOR.md records;
 *   - a door, a master and a reader vault are created from derived bytes; unlocked again from the same bytes on
 *     another "device"; everything read back; an unknown door address is ENOVAULT, not an error;
 *   - a write into a nested folder after a fresh open is there afterwards (the lazy-folder trap);
 *   - two clients racing a publish: the second gets ECAS, merges, and both changes survive;
 *   - a second door added while unlocked, then opened on its own; createWithId refuses an existing address;
 *   - the key shapes: a bare door key parses as a read key (the trap), the prefixed form classifies as a vault key;
 *   - with sgit-ai 0.21.0 installed: `sgit clone -` of a newsroom-made door from its prefixed key reads every file,
 *     `sgit commit` + `sgit push` is read back by the library, and the clone has write access. Skips with a message
 *     when sgit is not installed, never silently.
 *   - a live check against https://dev.send.sgraph.ai runs only when NEWSROOM_ACCESS_KEY is set; otherwise a LIVE: line
 *     says it did not run (not a SKIP: CI fails a test that skips, and the live check is optional by design).
 * No key, token, PRF byte or recovery code is printed: test keys are made per run and discarded.
 */
import vm from 'vm'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawnSync, spawn } from 'child_process'

// The mock runs in this process, so the CLI must be run asynchronously: spawnSync would block the event loop and the
// mock could not answer (which looks like a network timeout on the CLI's side).
const runAsync = (cmd, args, opts = {}) => new Promise(resolve => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    p.stdout.on('data', d => { stdout += d }); p.stderr.on('data', d => { stderr += d })
    const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch (e) { /* gone */ } }, opts.timeout || 180000)
    p.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
    if (opts.input) p.stdin.write(opts.input)
    p.stdin.end()
})
import { startMock } from './vault-mock.mjs'

import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium, engine, CLIPBOARD, canReadClipboard, clipboard } from './harness.mjs'
const ROOT = SITE
const VENDOR = path.join(API, 'assets/vendor/sg-vault/v0.2.3')
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

// --- the library, as the page loads it ---------------------------------------------------------------------------
const ORDER = ['sg-send/sg-send-crypto.js', 'sg-send/sg-send.js', 'sg-vault/sg-vault-crypto.js', 'sg-vault/sg-vault-object-store.js',
    'sg-vault/sg-vault-ref-manager.js', 'sg-vault/sg-vault-commit.js', 'sg-vault/sg-vault.js', 'sg-vault/sg-vault--file-ops.js',
    'sg-vault/sg-vault--folder-ops.js', 'sg-vault/sg-vault--sync.js', 'sg-vault/sg-vault--history.js', 'sg-vault/sg-vault--branches.js']
const vendorMd = fs.readFileSync(path.join(VENDOR, 'VENDOR.md'), 'utf8')
const recorded = Object.fromEntries([...vendorMd.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)].map(m => [m[1], m[2]]))
check(ORDER.every(f => recorded[f] === sha(path.join(VENDOR, f))), 'the twelve vendored files hash to what VENDOR.md records')
for (const f of ORDER) vm.runInThisContext(fs.readFileSync(path.join(VENDOR, f), 'utf8'), { filename: f })
vm.runInThisContext(fs.readFileSync(path.join(API, 'assets/vendor/sg-vault/local/sg-vault--create-with-id.js'), 'utf8'), { filename: 'sg-vault--create-with-id.js' })
vm.runInThisContext('globalThis.SGSend = SGSend; globalThis.SGVault = SGVault; globalThis.SGVaultCrypto = SGVaultCrypto; globalThis.SGSendCrypto = SGSendCrypto')
const nv = await import(path.join(API, 'assets/newsroom-vault.js'))
const lab = await import(path.join(API, 'passkey/lab.js'))
check(typeof SGVault.createWithId === 'function' && typeof nv.createAccount === 'function', 'the library, the local extension and newsroom-vault.js load in one realm')

// --- the mock -----------------------------------------------------------------------------------------------------
const mock = await startMock()
const sg = nv.client({ endpoint: mock.base, token: mock.token })
const bytes = n => crypto.getRandomValues(new Uint8Array(n))
const t0 = Date.now()
try {
    // A. the account: door, master, reader
    const prf = bytes(32)
    const door1 = await lab.doorFrom(prf)
    const acct = await nv.createAccount({ sgSend: sg, door: door1, record: { kind: 'passkey', provider: 'virtual', path: 'platform', credential_id: 'cred-1', device: 'test device' }, cloneBranch: 'nr-dev1' })
    check(mock.vaults().length === 3 && mock.vaults().includes(door1.vaultId), `three vaults exist on the server, the door at its derived id (${Date.now() - t0} ms)`)
    check(acct.master.vaultId !== door1.vaultId && acct.reader.vaultId !== acct.master.vaultId, 'the master and the reader have random ids of their own')
    const doorFiles = mock.files(door1.vaultId)
    check(doorFiles.some(f => /^bare\/refs\/ref-pid-muw-/.test(f)) && doorFiles.some(f => /^bare\/indexes\/idx-pid-muw-/.test(f)) && doorFiles.filter(f => f.startsWith('bare/data/obj-cas-imm-')).length >= 5, 'the door is a vault: a named ref, a branch index and content-addressed objects')
    check(mock.owners.get(door1.vaultId) && mock.owners.get(acct.master.vaultId) && mock.owners.get(door1.vaultId) !== mock.owners.get(acct.master.vaultId), 'each vault is owned by its own write key, fixed by the first write')
    check(!mock.log.some(l => /X-API-Key|x-api-key/.test(l)), 'the browser client never asked for X-API-Key')

    // B. unlock on another device from the same bytes
    const u = await nv.unlock({ sgSend: sg, door: await lab.doorFrom(prf), cloneBranch: 'nr-dev2' })
    check(u.master.vaultId === acct.master.vaultId && u.reader && u.reader.vaultId === acct.reader.vaultId, 'unlock from the same bytes opens the same master and reader')
    check(u.doors.length === 1 && u.doors[0].kind === 'passkey' && u.doors[0].path === 'platform' && u.doors[0].device === 'test device' && /^sgit_private_vault_[0-9a-f]{64}:[a-z0-9]{8}$/.test(u.doors[0].vault_key), 'the master lists the door with where it came from and its prefixed key')
    check(u.record && u.record.credential_id === 'cred-1' && /^\d{4}-\d{2}-\d{2}T/.test(u.record.created), 'the door carries its own record')
    check((await nv.readText(u.reader, '/README.md') || '').startsWith('# A reader vault'), 'the reader vault reads back')

    // C. an unknown door is "no door here", not an error
    const other = await lab.doorFrom(bytes(32))
    let code = null
    try { await nv.openVault(sg, nv.vaultKeyString(other.passphrase, other.vaultId), { cloneBranch: 'nr-dev2' }) } catch (e) { code = e.code }
    check(code === 'ENOVAULT', 'an unknown door address throws ENOVAULT, which the page shows as "no door here for this path yet"')

    // D. the lazy-folder trap: a nested write after a fresh open is there afterwards
    const readerKey = nv.vaultKeyString(...acct.reader.getVaultKey().split(/:(?=[^:]*$)/))
    const r2 = await nv.openVault(sg, readerKey, { cloneBranch: 'nr-dev3' })
    await nv.writeFile(r2, '/notes/2026/10', 'one.md', 'one'); await nv.publish(r2)
    const r3 = await nv.openVault(sg, readerKey, { cloneBranch: 'nr-dev4' })
    check(r3.needsLoading('/notes'), 'after a fresh open the sub-folder is a placeholder (the condition of the trap)')
    await nv.writeFile(r3, '/notes/2026/10', 'two.md', 'two'); await nv.publish(r3)
    const r4 = await nv.openVault(sg, readerKey, { cloneBranch: 'nr-dev5' })
    check((await nv.readText(r4, '/notes/2026/10/one.md')) === 'one' && (await nv.readText(r4, '/notes/2026/10/two.md')) === 'two', 'both files are in the nested folder after writes from fresh opens')

    // E. two clients racing a publish
    const A = await nv.openVault(sg, readerKey, { cloneBranch: 'nr-A' }), B = await nv.openVault(sg, readerKey, { cloneBranch: 'nr-B' })
    await nv.writeFile(A, '/race', 'a.txt', 'from A'); await nv.writeFile(B, '/race', 'b.txt', 'from B')
    const conflictsBefore = mock.stats.conflicts
    await nv.publish(A); await nv.publish(B)
    const after = await nv.openVault(sg, readerKey, { cloneBranch: 'nr-C' })
    check(mock.stats.conflicts > conflictsBefore, 'the second publisher hit the compare-and-swap (ECAS) and merged')
    check((await nv.readText(after, '/race/a.txt')) === 'from A' && (await nv.readText(after, '/race/b.txt')) === 'from B', 'both changes survive the race')
    check((await nv.readText(after, '/notes/2026/10/one.md')) === 'one', 'and the earlier files are still there')

    // F. a second door while unlocked, then opened on its own; an existing address is refused
    const rc = lab.recoveryCode()
    const door2 = await lab.doorFrom(rc.bytes)
    const added = await nv.addDoor({ sgSend: sg, master: u.master, door: door2, record: { kind: 'recovery', device: 'test device' }, cloneBranch: 'nr-dev2' })
    check(added.doors.length === 2 && mock.vaults().length === 4, 'a second door exists and the master lists two')
    const u2 = await nv.unlock({ sgSend: sg, door: door2, cloneBranch: 'nr-dev6' })
    check(u2.master.vaultId === acct.master.vaultId && u2.doors.length === 2 && u2.record.kind === 'recovery', 'the second door opens the same master on its own')
    let again = null
    try { await nv.createVaultWithId(sg, door1.passphrase, door1.vaultId, { cloneBranch: 'nr-x' }) } catch (e) { again = e.code }
    check(again === 'EEXISTS', 'createWithId refuses an address that already holds a vault')

    // G. key shapes
    const bare = `${door1.passphrase}:${door1.vaultId}`
    check(SGVaultCrypto.parseReadOnlyCredential(bare) !== null && SGVaultCrypto.classifyKey(bare) === 'unknown', 'the trap is real: a bare door key has the shape of a read key')
    check(SGVaultCrypto.classifyKey(nv.vaultKeyString(door1.passphrase, door1.vaultId)) === 'vault' && nv.stripKey(nv.vaultKeyString(door1.passphrase, door1.vaultId)) === bare, 'the prefixed form classifies as a vault key and strips back to the bare one')

    // H. the CLI round trip, sgit-ai 0.21.0
    const which = spawnSync('sgit', ['--version'], { encoding: 'utf8' })
    if (which.status !== 0) {
        console.log('SKIP: sgit is not installed (pip install sgit-ai==0.21.0), so the CLI round trip did not run')
    } else {
        console.log(`     ${which.stdout.trim()}`)
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-vault-'))
        // HOME is left alone: on a runner that installed sgit-ai with pip --user, the `sgit` script finds sgit_ai through
        // the user site under HOME, and overriding it hides the install. sgit keeps a clone's remote and token in the
        // clone's own .sg_vault/, so nothing of this run lands in the real home.
        const env = { ...process.env, SGIT_DEFAULT_BASE_URL: mock.baseLocalhost }
        const run = (args, opts = {}) => runAsync('sgit', args, { cwd: opts.cwd || tmp, input: opts.input, env })
        // the door, from its prefixed key, on stdin
        const doorDir = path.join(tmp, 'door')
        const c1 = await run(['clone', '-', doorDir, '--base-url', mock.baseLocalhost], { input: nv.vaultKeyString(door1.passphrase, door1.vaultId) + '\n' })
        const doorOk = c1.status === 0 && fs.existsSync(path.join(doorDir, 'master-key.json')) && fs.existsSync(path.join(doorDir, 'door.json'))
        check(doorOk, `sgit clone opens the door from its prefixed key and reads its files${doorOk ? '' : ': ' + (c1.stderr || c1.stdout).trim().split('\n').slice(-3).join(' | ')}`)
        if (doorOk) {
            const rec = JSON.parse(fs.readFileSync(path.join(doorDir, 'door.json'), 'utf8'))
            check(rec.kind === 'passkey' && rec.vault_id === door1.vaultId, 'the CLI reads the door record the browser wrote')
            // write access: a commit and a push from the clone
            fs.writeFileSync(path.join(doorDir, 'from-the-cli.txt'), 'written by sgit\n')
            const cm = await run(['commit', 'from the CLI'], { cwd: doorDir })
            const ps = await run(['--token', mock.token, 'push'], { cwd: doorDir })
            const pushed = cm.status === 0 && ps.status === 0
            check(pushed, `the clone has write access: sgit commit and sgit push succeed${pushed ? '' : ': ' + (cm.stderr + ps.stderr + ps.stdout).trim().split('\n').slice(-3).join(' | ')}`)
            const d3 = await nv.openVault(sg, nv.vaultKeyString(door1.passphrase, door1.vaultId), { cloneBranch: 'nr-dev7' })
            check((await nv.readText(d3, '/from-the-cli.txt')) === 'written by sgit\n' && (await nv.readJson(d3, '/master-key.json')).master, 'the library reads back what the CLI pushed, and the master key is still there')
        }
        // the reader vault with its nested folders
        const rdDir = path.join(tmp, 'reader')
        const c2 = await run(['clone', '-', rdDir, '--base-url', mock.baseLocalhost], { input: readerKey + '\n' })
        const files = c2.status === 0 ? ['README.md', 'notes/2026/10/one.md', 'notes/2026/10/two.md', 'race/a.txt', 'race/b.txt'].filter(f => fs.existsSync(path.join(rdDir, f))) : []
        check(files.length === 5, `sgit clone of the reader vault reads every file (${files.length} of 5)${c2.status ? ': ' + (c2.stderr || c2.stdout).trim().split('\n').slice(-2).join(' | ') : ''}`)
        fs.rmSync(tmp, { recursive: true, force: true })
    }

    // I. live, only with an access key
    if (process.env.NEWSROOM_ACCESS_KEY) {
        const live = nv.client({ endpoint: 'https://dev.send.sgraph.ai', token: process.env.NEWSROOM_ACCESS_KEY })
        const v = await nv.createVault(live, { name: 'newsroom test ' + new Date().toISOString().slice(0, 10) })
        await nv.writeFile(v, '/notes', 'hello.md', 'hello from the test\n'); await nv.publish(v)
        const again2 = await nv.openVault(live, v.getVaultKey(), { cloneBranch: 'nr-live-2' })
        check((await nv.readText(again2, '/notes/hello.md')) === 'hello from the test\n', `live: create, write, publish, re-open and read on dev.send.sgraph.ai (vault ${v.vaultId}, record it in the release note; the key is not printed)`)
    } else {
        console.log('LIVE: not run (no NEWSROOM_ACCESS_KEY in the environment); the checks above ran against the mock and the CLI')
    }
} finally {
    await mock.close()
}
console.log(`     mock: ${mock.stats.reads} reads, ${mock.stats.writes} writes in ${mock.stats.batches} batches, ${mock.stats.conflicts} conflict(s)`)
console.log(failed ? `${failed} FAILED` : 'ALL VAULT CHECKS PASS')
process.exit(failed ? 1 : 0)
