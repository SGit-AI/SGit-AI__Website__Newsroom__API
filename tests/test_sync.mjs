#!/usr/bin/env node
/* test_sync.mjs: the activity vault's sync logic (assets/vault-pane/sync.js), in Node, with two devices' states.
 *
 *   node admin/build/test_sync.mjs
 *
 * extract: a device's file holds only what it originated; consolidate: the union across devices, the best version
 * of a read, top-ups deduplicated by payment reference, totals recomputed from the records with one starting
 * credit; mergeInto: other devices' records into a local state, tagged, idempotent, and a device's next file after
 * a merge still holds only its own records. No network, no storage.
 */
import path from 'path'
import { API, SITE, API_HOSTNAME, apiUrl, isApi, routeApi, launch, needsChromium } from './harness.mjs'
const ROOT = SITE
const S = await import(path.join(API, 'assets/vault-pane/sync.js'))
let failed = 0
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++ }

const read = (id, at, cost, extra = {}) => ({ id, at, path: `/articles/${id}.html`, title: id, kind: 'article', topics: 'a b', price: 5, depth: 1, cost, persona: 'me', ...extra })
const A = { v: 3, created: '2026-10-12T09:00:00.000Z', balance: 500 - 5 - 2.5 + 500, spent: 7.5, reads: 2, declined: 0, log: [read('a2', '2026-10-12T10:00:00.000Z', 2.5, { depth: 0.5 }), read('a1', '2026-10-12T09:30:00.000Z', 5)],
            topups: [{ ref: 'cs_test_1', at: '2026-10-12T09:45:00.000Z', credit: 500, source: 'link' }], sessions: ['cs_test_1'], cart: [], active: 'me',
            personas: [{ id: 'me', name: 'D', created: '2026-10-12T09:00:00.000Z', on: ['a1'], off: [] }, { id: 'p1', preset: 'founder', name: 'Morgan', created: '2026-10-12T09:10:00.000Z', on: [], off: [], visitor: true }], shares: [] }
const B = { v: 3, created: '2026-10-12T11:00:00.000Z', balance: 500 - 10, spent: 10, reads: 2, declined: 3, log: [read('b2', '2026-10-12T11:20:00.000Z', 0, { declined: { reason: 'clickbait', at: '2026-10-12T11:21:00.000Z', refunded: 3 } }), read('b1', '2026-10-12T11:10:00.000Z', 10, { rating: { useful: 5, at: '2026-10-12T11:12:00.000Z' } })],
            topups: [], sessions: [], cart: [], active: 'me', personas: [{ id: 'me', name: '', created: '2026-10-12T11:00:00.000Z', on: ['b1'], off: ['x'] }], shares: [] }
const cfg = { start: 500, symbol: '£' }

// extract
const fA = S.extract(A, { id: 'nr-aaaa0001', label: 'laptop', agent: 'Chrome' })
const fB = S.extract(B, { id: 'nr-bbbb0002', label: 'iPad', agent: 'Safari' })
check(fA.reads.length === 2 && fA.reads.every(e => e.device === 'nr-aaaa0001') && fA.topups.length === 1 && fA.personas.length === 2 && fA.device.syncs === 1 && fA.device.first_sync === fA.device.last_sync, 'extract: a device file holds its reads, top-ups and personas, each tagged with the device, and counts its first sync')
const fA2 = S.extract(A, { id: 'nr-aaaa0001', label: 'laptop' }, fA)
check(fA2.device.syncs === 2 && fA2.device.first_sync === fA.device.first_sync, 'extract: the second sync keeps first_sync and counts up')
check(!('balance' in fA) && !('spent' in fA), 'extract: no totals are written, only records')

// consolidate
const acct = S.accountFile(cfg, 'nr-aaaa0001')
const C = S.consolidate([fB, fA], acct)
check(C.devices.length === 2 && C.devices[0].id === 'nr-aaaa0001' && C.devices[1].id === 'nr-bbbb0002' || C.devices.map(d => d.id).sort().join() === 'nr-aaaa0001,nr-bbbb0002', 'consolidate: both devices, by last sync')
check(C.totals.reads === 4 && C.totals.spent === 17.5 && C.totals.declined === 3 && C.totals.credit === 500 && C.totals.balance === 500 + 500 - 17.5, `consolidate: totals from the records with one starting credit (reads ${C.totals.reads}, spent ${C.totals.spent}, declined ${C.totals.declined}, credit ${C.totals.credit}, balance ${C.totals.balance})`)
check(C.reads[0].id === 'b2' && C.reads[3].id === 'a1', 'consolidate: reads ordered newest first across devices')
const dA = C.devices.find(d => d.id === 'nr-aaaa0001'), dB = C.devices.find(d => d.id === 'nr-bbbb0002')
check(dA.reads === 2 && dA.spent === 7.5 && dA.credit === 500 && dB.reads === 2 && dB.spent === 10 && dB.declined === 3, 'consolidate: per-device figures')
check(C.personas.find(p => p.id === 'me').on.sort().join() === 'a1,b1' && C.personas.find(p => p.id === 'me').off.join() === 'x' && C.personas.find(p => p.id === 'me').name === 'D' && C.personas.some(p => p.id === 'p1'), 'consolidate: the reader\'s own persona is the union of its lists across devices, a named one keeps its name, other personas are kept')
// a top-up seen on two devices (merged earlier) counts once
const fB2 = { ...fB, topups: [{ ref: 'cs_test_1', at: '2026-10-12T09:45:00.000Z', credit: 500, source: 'link', device: 'nr-aaaa0001' }] }
check(S.consolidate([fA, fB2], acct).totals.credit === 500, 'consolidate: the same payment reference on two devices is one top-up')
// the best version of a read wins when two files hold it
const fA3 = { ...fA, reads: fA.reads.map(e => e.id === 'a2' ? { ...e, depth: 1, cost: 5 } : e) }
check(S.consolidate([fA, fA3], acct).reads.find(e => e.id === 'a2').cost === 5, 'consolidate: of two versions of a read, the one that knows more (deeper, rated or declined) wins')
check(S.consolidate([], null).totals.balance === 0 && S.consolidate([], acct).totals.balance === 500, 'consolidate: an empty vault is the starting credit alone')

// mergeInto: B brings A's records in
const mB = S.mergeInto(B, C, 'nr-bbbb0002')
check(mB.added.reads === 2 && mB.added.topups === 1 && mB.added.personas === 1, `mergeInto: B gains A's 2 reads, 1 top-up and 1 persona (${JSON.stringify(mB.added)})`)
check(mB.state.log.length === 4 && mB.state.log.filter(e => e.device === 'nr-aaaa0001').length === 2 && mB.state.log.filter(e => !e.device).length === 2, 'mergeInto: foreign reads are tagged with their device; local ones are untouched')
check(mB.state.reads === 4 && mB.state.spent === 17.5 && mB.state.declined === 3 && mB.state.balance === 982.5 && mB.state.sessions.includes('cs_test_1'), `mergeInto: totals recomputed (balance ${mB.state.balance}) and the payment reference is now known here`)
const mB2 = S.mergeInto(mB.state, C, 'nr-bbbb0002')
check(mB2.added.reads === 0 && mB2.added.topups === 0 && mB2.added.personas === 0 && JSON.stringify(mB2.state) === JSON.stringify(mB.state), 'mergeInto: merging again changes nothing')
const fB3 = S.extract(mB.state, { id: 'nr-bbbb0002', label: 'iPad' }, fB)
check(fB3.reads.length === 2 && fB3.reads.every(e => e.device === 'nr-bbbb0002') && fB3.topups.length === 0, 'extract after a merge: B\'s file still holds only B\'s records')
check(S.consolidate([fA, fB3], acct).totals.reads === 4 && S.consolidate([fA, fB3], acct).totals.balance === 982.5, 'round trip: the vault after both devices synced again gives the same totals')
// A brings B's in, too: the two browsers agree
const mA = S.mergeInto(A, S.consolidate([fA, fB3], acct), 'nr-aaaa0001')
check(mA.state.balance === mB.state.balance && mA.state.reads === mB.state.reads && mA.state.spent === mB.state.spent, 'both browsers show the same balance, reads and spend after each brings the other in')
check(/2 read\(s\), 1 top-up\(s\), 2 persona\(s\), 0 note\(s\) from laptop/.test(S.describe(fA)), 'describe: what a sync writes, in words')

// notes: kept apart from the meter's state, carried in the same device file, merged the same way
const note = (id, at, kind, extra = {}) => ({ id, at, kind, path: '/articles/x.html', title: 'X', n: 82, story: null, text: '', quote: '', persona: 'me', ...extra })
const NA = { v: 1, notes: [note('n-a2', '2026-10-12T10:05:00.000Z', 'idea', { text: 'a mode row' }), note('n-a1', '2026-10-12T09:35:00.000Z', 'wrong', { quote: 'the second paragraph', sent: { at: '2026-10-12T09:40:00.000Z', lane: 'lane0001' } })] }
const NB = { v: 1, notes: [note('n-b1', '2026-10-12T11:15:00.000Z', 'not-for-me', { path: '/wire/', story: 's-7', n: null })] }
const gA = S.extract(A, { id: 'nr-aaaa0001', label: 'laptop' }, null, { notes: NA.notes })
const gB = S.extract(B, { id: 'nr-bbbb0002', label: 'iPad' }, null, { notes: NB.notes })
check(gA.notes.length === 2 && gA.notes.every(n => n.device === 'nr-aaaa0001') && gB.notes.length === 1 && S.extract(A, { id: 'nr-aaaa0001' }).notes.length === 0, 'extract: a device file carries its own notes, tagged, and none when no store is given')
check(/2 note\(s\) from laptop/.test(S.describe(gA)), 'describe: counts the notes')
const CN = S.consolidate([gB, gA], acct)
check(CN.notes.length === 3 && CN.notes[0].id === 'n-b1' && CN.totals.notes === 3 && CN.totals.sent === 1 && CN.devices.find(d => d.id === 'nr-aaaa0001').notes === 2 && CN.devices.find(d => d.id === 'nr-aaaa0001').sent === 1, `consolidate: notes across devices, newest first, sent counted (${CN.totals.notes} notes, ${CN.totals.sent} sent)`)
const gA2 = { ...gA, notes: gA.notes.map(n => n.id === 'n-a2' ? { ...n, sent: { at: '2026-10-12T10:10:00.000Z', lane: 'lane0001' } } : n) }
check(S.consolidate([gA, gA2], acct).notes.find(n => n.id === 'n-a2').sent && S.consolidate([gA2, gA], acct).notes.find(n => n.id === 'n-a2').sent, 'consolidate: of two versions of a note, the sent one wins whichever file comes first')
const mnB = S.mergeNotes(NB, CN, 'nr-bbbb0002')
check(mnB.added === 2 && mnB.store.notes.length === 3 && mnB.store.notes.filter(n => n.device === 'nr-aaaa0001').length === 2 && mnB.store.notes.filter(n => !n.device).length === 1, `mergeNotes: B gains A's 2 notes, tagged; its own untouched (${mnB.added} added)`)
const mnB2 = S.mergeNotes(mnB.store, CN, 'nr-bbbb0002')
check(mnB2.added === 0 && JSON.stringify(mnB2.store) === JSON.stringify(mnB.store), 'mergeNotes: merging again changes nothing')
const gB2 = S.extract(B, { id: 'nr-bbbb0002', label: 'iPad' }, gB, { notes: mnB.store.notes })
check(gB2.notes.length === 1 && gB2.notes[0].id === 'n-b1', 'extract after a merge: B\'s file still holds only B\'s notes')
check(S.mergeNotes(null, CN, 'nr-cccc0003').store.notes.length === 3 && S.mergeNotes({ v: 1, notes: [] }, { notes: [] }, 'x').added === 0, 'mergeNotes: an empty or missing store takes every note; an empty vault adds none')

// the wire: stories seen travel in the device file; the earliest sighting wins; a merge tags them and is idempotent
const WA = { 'sec-01': { at: '2026-10-13T08:00:00.000Z' }, 'ai-01': { at: '2026-10-13T08:00:00.000Z' }, 'biz-01': { at: '2026-10-13T08:05:00.000Z', device: 'nr-cccc0003' } }
const WB = { 'sec-01': { at: '2026-10-13T07:00:00.000Z' }, 'ai-09': { at: '2026-10-13T09:00:00.000Z' } }
const hA = S.extract(A, { id: 'nr-aaaa0001' }, null, { notes: [], wire: WA }), hB = S.extract(B, { id: 'nr-bbbb0002' }, null, { notes: [], wire: WB })
check(Object.keys(hA.wire.seen).sort().join() === 'ai-01,sec-01' && !hA.wire.seen['sec-01'].device, 'extract: a device file carries the stories it saw, not the ones brought in from another device')
check(Object.keys(S.extract(A, { id: 'nr-aaaa0001' }).wire.seen).length === 0, 'extract: no wire state, no stories seen')
const CW = S.consolidate([hA, hB], acct)
check(CW.totals.seen === 3 && CW.wire.seen['sec-01'].at === '2026-10-13T07:00:00.000Z' && CW.wire.seen['sec-01'].device === 'nr-bbbb0002', 'consolidate: the union of stories seen, each with the earliest sighting and the device that made it')
const mwA = S.mergeWire({ v: 1, seen: { ...WA }, lens: 'dinis' }, CW, 'nr-aaaa0001')
check(mwA.added === 1 && mwA.store.seen['ai-09'].device === 'nr-bbbb0002' && mwA.store.seen['ai-01'].at === WA['ai-01'].at && mwA.store.lens === 'dinis', `mergeWire: A gains what only B saw, tagged with B, and keeps its own and its lens (${mwA.added} added)`)
check(S.mergeWire(mwA.store, CW, 'nr-aaaa0001').added === 0, 'mergeWire: merging again adds nothing')
check(Object.keys(S.extract(A, { id: 'nr-aaaa0001' }, null, { wire: mwA.store.seen }).wire.seen).sort().join() === 'ai-01,sec-01', 'extract after a merge: A still writes only what it saw itself')
check(/2 wire stories seen/.test(S.describe(hA)), 'describe: counts the wire stories seen')
// which of the wire vault's releases to show
const W = await import(path.join(API, 'assets/vault-pane/wire-state.js'))
const rel = { schema: 'wire-releases/v1', releases: [{ id: 'r1', at: '2026-10-11T08:00:00Z' }, { id: 'r3', at: '2026-10-13T08:30:00Z' }, { id: 'r2', at: '2026-10-12T08:00:00Z' }] }
check(W.releasesSince(rel, '2026-10-11T12:00:00Z').map(r => r.id).join() === 'r3,r2', 'releasesSince: the releases after the last visit, newest first')
check(W.releasesSince(rel, null).map(r => r.id).join() === 'r3' && W.releasesSince(rel, '2026-10-14T00:00:00Z').map(r => r.id).join() === 'r3', 'releasesSince: on a first visit, or with nothing newer, the latest alone')
check(W.releasesSince(null, null).length === 0 && W.releasesSince({ releases: [{ id: 'x' }] }, null).length === 0, 'releasesSince: no file, or entries without a time, show nothing')

console.log(failed ? `${failed} FAILED` : 'ALL SYNC CHECKS PASS')
process.exit(failed ? 1 : 0)
