# The move to api.newsroom.sgit.ai: the brief, refreshed at newsroom v0.12.10

13 October 2026. Written by the Claude Code session that works on the newsroom repositories, for
Dinis Cruz, who decides what ships. It refreshes the brief in
[Go slow to go fast](https://newsroom.sgit.ai/articles/explorer-to-villager-newsroom.html) (11 October,
measured on newsroom v0.8.0) against the newsroom as it is today (v0.12.10, commit `631738b1`), and
against two decisions taken since: this repository is `SGit-AI__Website__Newsroom__API`, not
`SGit-AI__Newsroom__API`, and what it releases is served from a host of its own,
**api.newsroom.sgit.ai**, instead of being copied into the sites that use it.

The article's case, its six phases, its seven rules and its security starting points stand. This note
changes only what the two decisions and two days of shipping changed: the hosting model, the list of
what moves, the scope of the freeze, and the order of the first steps. Where it departs from the
article it says so.

## In one line

The newsroom keeps every page and every address; the code those pages run moves here, unchanged, and
is served from api.newsroom.sgit.ai at versioned paths that the newsroom and sgit.ai pin; the proof
of the move is that the live site serves the same bytes before and after, with one new rule in the
normaliser for the host prefix.

## What changed since the brief was written

| | In the article (v0.8.0, 11 Oct) | Today (v0.12.10, 13 Oct) |
|---|---|---|
| Reader code that runs in a browser | about 2,700 lines | 8,661 lines in 49 files (the map's count) |
| Frozen meter versions | 5,016 lines in 10 files | 5,697 lines in 20 files (v1.0.0 to v1.3.1, with .css and .tpl) |
| Tests | 433 lines in 3 files, never run in CI | 2,112 lines, 413 check calls, 12 files, run in CI on Chromium (finding R11, fixed) |
| Pages written for the reader code | 12 | 22 |
| Features the article listed as waiting for phase 5 | the vault, the passkey, the agent pack | the vault page and pane, the passkey lab, the wire as an inbox, search and ask, notes to a lane, and publishing from the newsroom repository all shipped |
| Upstreams of the reader code | 2 | 2, plus a third: `SGraph-AI__App__Send` v0.2.3, vendored |
| Repository name | `SGit-AI__Newsroom__API` | `SGit-AI__Website__Newsroom__API` |
| Where released files live | copied into each site and pinned | served from api.newsroom.sgit.ai, pinned by URL |
| Phase 0 | to do | done, in the newsroom: `/newsroom-api/`, `map.json`, 18 findings, regenerated on every build |

Two things follow. The map the move needs exists, but it lives in the newsroom and is regenerated on
every build, so the "before" has to be frozen into this repository at the commit before the move.
And rule 1 of the brief ("no behaviour changes until phase five") was not held in the newsroom
repository, which is where features ship daily. This note does not pretend otherwise; it re-scopes
the freeze (below) to the files that move, from the commit that moves them.

## The hosting model

**api.newsroom.sgit.ai is this repository's GitHub Pages site.** A `CNAME` file in this repository
names it; DNS for `api.newsroom.sgit.ai` is a CNAME to `sgit-ai.github.io`; Pages is enabled on the
default branch. Both of the latter are Dinis's to set. As of today the name does not answer (a probe
from this session got no DNS answer and a 502 from the proxy).

**Why a host works for client-side code.** Checked today against newsroom.sgit.ai, GitHub Pages
serves every file with `access-control-allow-origin: *`. That is what a cross-origin ES module
import needs, and what `sg-component.js` needs when it fetches a component's `.tpl` and `.css` beside
its `.js` through `import.meta.url`. So a page on newsroom.sgit.ai can do
`import('https://api.newsroom.sgit.ai/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter.js')` and
the component finds its siblings on the API host on its own.

**What a different host does not change, and must not.**

- **The reader's state stays where it is.** `localStorage` and `sessionStorage` belong to the page's
  origin, not the script's. The meter's `sgit.meter.v1` stays on newsroom.sgit.ai whichever host
  serves the script. No reader loses a balance, a persona or a reading list. This is the single most
  important property of the move and it holds by construction; a test records it anyway.
- **Content is fetched from the page's origin.** The meter's `cfg.root + picks.feed`
  (`articles/graphs.json`), the reading list's `articles/ids.json`, and `cfg.root + contact`
  (`.well-known/sgit-subscribe.json`) are the newsroom's own data and keep resolving against the
  page. `cfg.root` is not changed by the move.
- **Every address stays.** `/account/topped-up.html` is the Stripe return URL, `/for/#…` and
  `/persona/<id>/` are published link grammars, `/.well-known/sgit-subscribe.json` is a well-known
  path by convention. HTML pages do not move to the API host (and cannot: a page on another origin
  would have another origin's storage).

**What it does change.**

- **The import URL on every page.** Today each page's loader imports the meter by a relative path
  with sgit.ai's cache-buster (`…/sg-meter.js?v=v0.7.86`). After the move it imports the same path
  under `https://api.newsroom.sgit.ai/`. That is the one byte change the move makes to pages, so the
  normaliser used for the hash proof (`NORMALISE` in `sync_newsroom.py`, mirrored by validate.js
  check 11) gets one more rule: the host prefix on reader-file URLs is set aside, exactly as the
  sync's rule 11 already sets aside the v1.3.1 to v1.4.0 path rewrite. The scripts, styles and JSON
  themselves hash identical, raw.
- **A Content-Security-Policy has one more origin to name.** When one is added (finding R10, phase
  5), `script-src` and `connect-src` include api.newsroom.sgit.ai. That is a reason to add it after
  the move, not before.
- **The loader's eval path crosses an origin.** Imported pages fetch `assets/site.js`,
  `subscribe.js` and `shots.js` as text and run them with `(0, eval)(text)` (R10). `subscribe.js`
  moves; a cross-origin fetch of it works under the CORS header above, and the eval is unchanged.
  Replacing the eval with `<script src>` or `import()` is a phase 5 change.

**Paths are identical under the new host, for now.** The move keeps every path as it is
(`assets/components/sg-meter/v1/v1.4/v1.4.0/…`, `for/reading-list.js`, `assets/vault-pane/…`) so
that the move is a prefix rewrite and nothing else, and so the frozen versions' paths stay true.
`assets/` is an odd first segment for an API host; reshaping paths is a phase 4 change, made with
the tests under it. This departs from nothing in the article, but it is a choice, so it is listed
below for Dinis.

**Releases and pinning.** A release of this repository is a tag `vX.Y.Z` on its default branch, with
the version owned by one file (as the newsroom's `admin/build/version.txt` is), and it publishes
`releases/vX.Y.Z/manifest.json`: every served path with its bytes and SHA-256, plus the component
versions it carries (the meter's own `v1.4.0` line is unchanged by this; the API release number is a
different number). A consuming site pins in one place, a file naming the API release, and its build
writes every reader URL from it. Its gate checks three things: every reader file the pages load is a
URL on the pinned host; no reader file is loaded unversioned; and, at the end of a release, the live
host serves each file with the hash in the manifest, because
[green does not mean live](https://newsroom.sgit.ai/articles/green-does-not-mean-live.html). A
rollback is a change to the one file. A published path is never edited in place (R16): a change is a
new version path, always.

**The frozen versions.** The 20 files of v1.0.0 to v1.3.1 are served from api.newsroom.sgit.ai at
their paths, and the newsroom keeps its own copies in place, frozen, until phase 4: GitHub Pages
cannot redirect a script, and nothing checks who still loads them. The newsroom's gate checks the two
copies are byte-identical. sgit.ai's copies are sgit.ai's to retire.

**sgit.ai.** The second consumer. It pins the same host and the same release, stops building the
account pages, subscribe and the meter, and retires its v1.3.1 line. After that the newsroom's sync
carries no reader code and the two-upstreams finding (R12) is closed by construction. This part needs
the sgit.ai session.

**Pre-production.** Unchanged from the article: GitHub Pages serves one site per repository, so a
pull request here cannot have its own Pages preview. The pre-production copy is a copy of the
newsroom on a host name of its own (its `main` branch, which its workflow already describes as a
deploy test, or a separate repository), pinned to the release under test, with a Stripe link in test
mode. This repository's own pipeline tests its files against a local static server and against that
copy.

## What moves, re-cut from the v0.12.10 map

The principle: **what the browser runs moves; what writes a page stays with the site that serves the
page, and pins.** The table is from `newsroom-api/map.json` at v0.12.10; the lines are the map's.

### 1a. Files the browser runs: move, one copy-and-cut commit, same bytes

| Group | Files | Lines | Today's upstream | Note |
|---|---|---|---|---|
| SG Meter v1.4.0 (`.js`, `-core.js`, `.css`, `.tpl`) | 4 | 1,515 | the newsroom, forked from sgit.ai's v1.3.1 | the line that continues |
| Component base `sg-component.js` v1.0.0 | 1 | 118 | sgit.ai, verbatim | becomes this repository's own |
| Reading lists (`for/reading-list.js`, `make.js`, `for.css`) | 3 | 706 | the newsroom | |
| `assets/subscribe.js` | 1 | 117 | sgit.ai, verbatim | the one moved file still run by eval |
| The vault layer (`newsroom-vault.js`, `door.js`, `vault-pane/` × 7) | 9 | 1,611 | the newsroom | the reader's vault, the pane, notes, sync; talks to `dev.send.sgraph.ai` and `dev.vault.sgraph.ai` (R5) |
| Search and ask (`assets/search/` × 5) | 5 | 555 | the newsroom | `ask.js` calls openrouter.ai only with the reader's own key |
| The wire reader (`wire/wire.js`, `wire.css`, `vault-reader.js`) | 3 | 612 | the newsroom; `vault-reader.js` vendored from sgit.ai's vault | reads the wire's vault live |
| Vendored sg-vault v0.2.3 (12 files) and `sg-vault--create-with-id.js` | 13 | 2,900 | `SGraph-AI__App__Send` v0.2.3; one file pending upstream | the third upstream: moves as vendored, pinned to the upstream version, never edited |
| The passkey lab (`passkey/lab.js`, `lab.css`, `vectors.json`) | 3 | 392 | the newsroom | a lab, not a feature; moves because it is reader-run code with a test |
| **Total** | **42** | **8,526** | | |

### 1b. Frozen: move, and stay

| Group | Files | Lines |
|---|---|---|
| SG Meter v1.0.0, v1.1.0, v1.2.0, v1.3.0, v1.3.1 | 20 | 5,697 |

Published artefacts, served from both hosts byte for byte; their only test is that they still are.

### 1c. Stays with the site that serves it

| File | Lines | Why it stays |
|---|---|---|
| `assets/site.js`, `assets/shots.js` | 359 | sgit.ai's page chrome and figure loader, imported with the content; not reader features |
| `assets/nav.js` | 42 | the newsroom's own chrome |
| `assets/vault-ui-embed.js` | 126 | sgit.ai's, used by the synthetic-readers study page only; goes with that page |
| `articles/graphs.json`, `articles/ids.json`, `persona/links.json`, `wire/snapshot.json`, `search/docs.json`, `search/text.json` | | data generated from the content, fetched from the page's origin; the **formats** of `ids.json` and `links.json` are this repository's contracts, the files are the newsroom's |
| `.well-known/sgit-subscribe.json` | 25 | a well-known path on the newsroom's origin. Today it is sgit.ai's file verbatim (R4). After the move it is the newsroom's own file at the same bytes; changing `site` and `From:` to the newsroom is a phase 5 fix |
| The 22 reader pages (`account/`, `subscribe/`, `persona/`, `for/`, `wire/`, `vault/`, `meter/`, the study) | | addresses are contracts and state is per origin; the pages stay and import from the host |

### 2. Tests: move with the code

All twelve files in `admin/build/test_*.mjs` and `vault-mock.mjs` (2,112 lines, 413 check calls):
the meter, the lists, the review's pinned findings, the passkey lab, the wire (against the real
vault), the vault library (Node, with the sgit CLI round trip), sync, the pane, search, ask and the
notes loop. They run here on every commit, in Chromium first and then in WebKit and Firefox, against
a local static server that serves this repository's tree at the API paths and a copy of the newsroom's
pages pointed at it. The newsroom's workflow keeps running them against its own tree until the move
commit lands, then drops the job and keeps only its gate.

### 3. Build code: decide, do not move yet

The article moved "the build code for article numbers, lists and personas". Under the principle
above most of it writes pages, which stay with the site. Proposed:

| Code | Lines | Proposal |
|---|---|---|
| `ids.py` (assigns article numbers) | 156 | **stays** in the newsroom: it reads the articles, and the number is assigned where the article is published. The `ids.json` format and its parser tests are this repository's |
| `lists.py`, `personas.py`, `vault_page.py`, `wire.py`, `passkey_lab.py` (write reader pages) | 678 | **stay** and pin: they write pages with the newsroom's chrome; the only change is the host and version in the import they write. A later step can move the page bodies here as templates the sites render |
| `passkey_vectors.py` | | **moves**: it writes `vectors.json`, which moves |
| `lane.py` (reads a reader's lane with its key) | 147 | **stays**: an operator's tool for the newsroom's lane, not a reader feature |
| `api_map.py` (the map) | | **moves**, and is pointed at this repository's tree plus the pinned pages; regenerated nightly here, as the article says, and compared with yesterday's |
| `sync_newsroom.py` rules 11 and 12, `newsroom-meter.json` | | **stay** until sgit.ai pins; rule 11 is then deleted and the sync refuses any reader file in the import |

## The freeze, re-scoped

The article's rule 1 froze everything until phase 5. Two days of shipping in the newsroom show that
the freeze cannot be on the newsroom repository, which publishes daily. Refreshed:

- **From the move commit, the files in 1a and 1b are frozen in this repository**: no feature, no fix,
  no copy edit, until phase 4 is finished. A change to a frozen file before then is a new version path
  with a test that fails without it, and a reason written in the pull request.
- **The newsroom keeps shipping content and chrome.** A new reader feature it needs before phase 5 is
  built here as a new versioned file, not in the newsroom tree, so that it is in the map and the tests
  from its first day. That is a cost, and it is the point.
- **The hash rule applies to the moved files and the 22 pages**, with the one added normaliser rule.

## Phases, where they stand

| Phase | Article | State at v0.12.10 | What this note changes |
|---|---|---|---|
| 0. Map | map in the new repository, nightly | done in the newsroom, per build | the "before" is frozen into this repository; `api_map.py` moves and runs nightly here |
| 1. Move | one commit, same bytes, both sites pin copies | not started | split into 1a (files), 1b (frozen), 1c (stays); served from a host, pinned by URL and manifest |
| 2. Test | Node, three engines, pre-prod, synthetic readers; bugs as passing tests | 413 checks run in CI, Chromium only; 14 of the 18 findings pinned | unchanged, with WebKit and Firefox added here and the tests moved |
| 3. Review | every finding an issue | 18 findings in a note; 0 issues in this repository | the 18 become this repository's first issues, labelled by phase, area and severity |
| 4. Refactor | adversarial changes, every test passing | not started | paths reshaped here, not before |
| 5. The explorer returns | fixes, then the vault, the passkey, the agent pack | the vault and passkey shipped in the newsroom already | the fixes (R1 to R18), the CSP, the eval loader, the sgit.ai `site:` fields; new features land here first |

## The pipeline for this repository

As the article asks, with the host added:

- **Every commit, under two minutes:** lint; Node tests (the parser, the money, the state, the vault
  library against the mock); Chromium, WebKit and Firefox on phone and desktop sizes against a local
  static server; a build that produces the same bytes twice, with the version and the date from a
  file. The newsroom's reader-tests job runs in about ten minutes today because it installs Chromium
  and the sgit CLI each time; caching both is the first thing to measure.
- **Every merge:** publish to api.newsroom.sgit.ai (Pages, from the default branch), then the
  pre-production newsroom pinned to the merge, smoke tests of every reader page and control, a short
  synthetic reader run.
- **Every release:** tag, manifest, then the consuming sites' one-line pins in their own commits, and
  each site's release ends by asking the live host for every file's hash.
- **Every night:** the full synthetic study, the adversarial changes, dependency and header checks,
  the map regenerated and compared with yesterday's.
- **Review:** one person and one agent reviewer per pull request, the agent's verdict as a required
  status check.

## Decisions for Dinis

1. **The host model as described**: Pages for this repository, `CNAME` here (added with this note),
   DNS `api.newsroom.sgit.ai CNAME sgit-ai.github.io`, Pages enabled on the default branch. The DNS
   and the Pages setting are yours.
2. **Identical paths under the host in phase 1**, reshaped in phase 4. The alternative is to reshape
   now and lose the prefix-only proof.
3. **The freeze re-scoped** to the moved files, with new reader features built here from their first
   day.
4. **`ids.py` stays with the content**; the format is this repository's. The article moved it.
5. **The frozen versions are served from both hosts** until phase 4.
6. **Pre-production is the newsroom's `main` on its own host name**, or a separate repository.
7. **The agent reviewer**: an account with write access, or a status check that branch protection
   requires.
8. **Which private vault** holds the vulnerability tests and their issues until each fix lands.
9. **The release number of this repository**: it is not the meter's. Proposed: start at `v0.1.0` for
   the move and reach `v1.0.0` when phase 4 is finished.

## The first steps, in order

1. **This repository, before anything moves** (this session): the README's first line (a client-side
   API: components, formats and contracts the browser runs, no server), `CNAME`, this note; the
   "before" map and its hashes copied in from the newsroom at the commit before the move; the 18
   findings filed as issues with labels; the pipeline skeleton (lint, Node, three engines, the
   reproducible build) running on an empty tree.
2. **Dinis**: DNS and Pages. The move cannot be proved until the host answers.
3. **The move commit here (1a and 1b)**: the 62 files copied at their paths, no edits, the tests
   with them, `releases/v0.1.0/manifest.json`, tag `v0.1.0`.
4. **The newsroom's one commit**: the pin file; the loader on every page importing from the host;
   the normaliser's prefix rule; gate checks for pinned host, versioned paths and byte-identical
   frozen copies; the before-and-after hash run, which must show zero differences; the reader-tests
   job removed from its workflow. The moved files are deleted from its tree in the same commit, apart
   from the frozen copies.
5. **sgit.ai pins**, and the sync's rule 11 is deleted. Phase 1 is finished when both sites pin and
   the live hashes match.

## Acceptance, refreshed

| # | Done when |
|---|---|
| 1 | The before-map is in this repository and the map is regenerated here nightly |
| 2 | api.newsroom.sgit.ai serves `releases/vX.Y.Z/manifest.json` and every file in it, with the CORS header; both sites pin it; the newsroom's sync carries no reader code; every reader file on the live newsroom hashes the same as before the move, pages normalised with the one added rule |
| 3 | The commit pipeline runs here in under two minutes: lint, Node, Chromium, WebKit, Firefox, reproducible build |
| 4 | Pre-production runs on every merge, on its own host name, pinned to the merge, with a Stripe test link, smoke tests and a short synthetic run |
| 5 | Every known bug and vulnerability is a passing test and an open issue here (18 to start) |
| 6 | Every pull request has one person and one agent reviewer |
| 7 | No adversarial change to what a reader sees or pays slips through the tests |
| 8 | Only then: the fixes, the CSP, the eval loader, and new features, built here first |

## Sources

- The brief: <https://newsroom.sgit.ai/articles/explorer-to-villager-newsroom.html> (article v1.2.0)
- The map and review: <https://newsroom.sgit.ai/newsroom-api/>, `newsroom-api/map.json`,
  `admin/notes/2026-10-11__newsroom-api-map-and-review.md` in the newsroom repository, all at v0.12.10
- The earlier move and its tooling: `admin/notes/2026-10-10__newsroom-move-and-content-audit.md`,
  `admin/build/sync_newsroom.py` (rules 11 and 12, `NORMALISE`), `admin/build/validate.js` (check 11)
- The CORS check: `curl -sI https://newsroom.sgit.ai/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter.js`
  on 13 October 2026 returned `access-control-allow-origin: *`

---

## Addendum, 13 October, written with the move commit

Dinis confirmed the decisions above (DNS set; identical paths; the re-scoped freeze; `ids.py` stays; release
numbering from v0.1.0). Doing the move changed three things in this note, and found one.

1. **The paths are identical under a versioned prefix**, `https://api.newsroom.sgit.ai/<release>/<path>`, not
   bare under the host. Identical paths alone would have made `assets/vault-pane/vault-pane.js` and every other
   unversioned file an unversioned URL, which rule 7 forbids and R16 warns about. One release directory per
   release, never edited after it is published; the newsroom pins the release in one file; the normaliser's one
   added rule sets the prefix aside. The meter's own component versions nest inside it unchanged.
2. **Three files could not move unchanged.** `assets/vault-pane/vault-pane.js`, `assets/search/search.js` and
   `assets/search/ask.js` located the site root from their own URL (`new URL('../../', import.meta.url)`), which
   on another host is the API host: the pane's links to pages, the search's `docs.json` and `text.json`, and its
   links would all have pointed at api.newsroom.sgit.ai. Each now takes the site root from the page
   (`<html data-root>`, which every page carries) and keeps a second root, its own, for the code it loads. The
   manifest records each with its before-hash and the reason; `tools/release.py` refuses any other difference
   from the newsroom's bytes. Everything else, 60 files and the 20 frozen, hashes identical.
3. **The proof covers every page, not only the 22.** `tools/prove_move.py` normalises all 597 pages of the
   newsroom before and after: 593 identical; the four that differ are the release's own (the versions table,
   the engineering board, the search page's count of documents, the passkey page's note on where the vectors
   come from) and two pages are new (the card and the release). The report is `map/proof/v0.1.0.json`.
4. **sgit.ai has already moved on.** Its v0.7.87 ("the newsroom has moved, phase one") puts a banner on every
   newsroom page it still serves, between `<!--moved:start-->` and `<!--moved:end-->` for the import to cut out,
   with a canonical URL pointing here, and says phase two deletes the pages. The next sync must cut that banner;
   sgit.ai's pinning of this release (phase 1's last step) and the deletion of the sync's rule 11 wait on the
   sgit.ai session.

**14 October, the second cut.** By the time the newsroom came to take v0.1.0, its `dev` had moved forty releases past the base of the first cut (v0.12.10 to v0.12.50), and the reader code with it: the meter to v1.4.1, the pane's inbox and send, the wire's graphs and subscribe form, a QR-code vendor. Merging the first cut would have regressed the live reader code, so the move was cut again from v0.12.50 as release v0.2.0 (74 files, the same three host changes), proved again (`map/proof/v0.2.0.json`), and the newsroom's pin commit was redone as a merge on top of `dev`. v0.1.0 stays published. The lesson for the sync between the two repositories: cut the release from the newsroom commit that will pin it, in the same hour.

What the move commit contains, on both sides, is in each repository's README and in the newsroom's release note
v0.13.0 and card 036. Order of merging: this repository's `main` first (Pages publishes `v0.1.0/`, and the
`live` job proves every hash), then the newsroom's `dev`, whose pages load from that host.
