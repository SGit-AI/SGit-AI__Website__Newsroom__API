# For agents

> The brief for the agents that keep this repository and the newsroom: what the API is, the rules, where everything is, how a change is made and reviewed, how the newsroom consumes a release, and what never to do. Written for people too.

*api.newsroom.sgit.ai · v0.2.11 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/agents/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# For agents

> You are reading the brief for the agents that keep this repository, and for the ones that keep newsroom.sgit.ai and consume it. It is public because the work is. A person changing the code should read it too.

## What this is, in three lines

The code a reader runs on newsroom.sgit.ai, released from this repository and served from `https://api.newsroom.sgit.ai/<release>/<path>`, never edited after it is published. "API" means client-side: components, formats and contracts the browser runs; no server. The newsroom (and, next, sgit.ai) pins one release.

## Read these first

1. [`llms.txt`](../llms.txt): every page of this site with one line each; [`llms-full.txt`](../llms-full.txt) is the whole site in one fetch.
2. [The current manifest](../{{release}}/manifest.json): every served path, bytes, SHA-256, and which files differ from the newsroom's bytes and why.
3. [`briefs/`]({{github}}/tree/dev/briefs): the plan, refreshed at newsroom v0.12.10, with the addendum written when the move was done. The original is [Go slow to go fast](https://newsroom.sgit.ai/articles/explorer-to-villager-newsroom.html).
4. [`map/before/`]({{github}}/tree/dev/map/before): the map of everything a reader runs, as it was before the move; [the review](../review/) is read from it.
5. [`tests/`]({{github}}/tree/dev/tests): what is proved, and how the harness works.

## The rules

- **The served files are frozen** until phase 4 of the brief is finished. A change is a new release with a test that fails without it and a reason in the pull request. A fix to a review finding is a deliberate change to the test that pinned it.
- **A release is a directory that is never changed.** `releases/<v>/` and its `manifest.json`, cut by `tools/release.py cut`; `check` recomputes every hash and fails when the tree is not the release `tools/version.json` names. Nothing is loaded unversioned.
- **Identical paths, for now.** A served path is the path the file had in the newsroom; reshaping is phase 4.
- **Three files locate the site root from the page** (`data-root`), not from their own URL: `vault-pane.js`, `search.js`, `ask.js`. Any new file that links to pages or fetches site data does the same.
- **Tests in three engines on every commit**, against the newsroom at the commit in `tests/newsroom.json`; a `SKIP` fails CI. Clipboard reads and CDP (the virtual authenticator, the faked built-in model) are Chromium's.
- **A pull request needs a person and an agent reviewer.** The agent's review is a required check.
- **Bugs and vulnerabilities are tests that pass**, recording the behaviour as it is, with an issue; a vulnerability test and its issue stay in a private vault until the fix lands.
- **No third-party script on a reader page.** One vendored library, pinned at a version, never edited here.

## Where things are

| | |
|---|---|
| the served files | `assets/`, `for/`, `wire/`, `passkey/` at the root; `tools/served.json` is the list |
| releases | `releases/<v>/`, `tools/version.json`, `tools/release.py` (cut, check, site), `tools/live_check.py` |
| the proof of the move | `tools/prove_move.py`, `map/proof/<v>.json` |
| the tests | `tests/harness.mjs` (two trees: API and SITE; routes the host to the tree), `tests/test_*.mjs`, `tests/vault-mock.mjs`, `tests/newsroom.json` |
| this site | `site/build.py` → `www/`; pages in `site/pages/` (markdown or HTML fragments with front matter); data in `site/data/`; release notes in `site/releases/`; `--check` in CI |
| the map | `map/before/<newsroom release>/map.json` and `hashes.json`; `tools/api_map.py` (moved from the newsroom; to be re-pointed at this tree and a newsroom checkout, nightly) |
| the review's findings | issues 1 to 18, labelled by phase, area and severity |
| CI and deploy | `.github/workflows/ci.yml`, `deploy-pages.yml` (main: check, tag, Pages, live check) |

## How the newsroom consumes a release

`admin/build/api.json` pins the release; `admin/build/api-manifest.json` is its manifest, copied; `admin/build/api.py` writes every reference (`--repoint`), recomputes the import gate's hashes (`--rerecord`) and checks every page; `validate.js` check 14 refuses a relative, unpinned or unlisted reader-file reference, check 13 holds the frozen meter copies to the manifest; the sync's items 11 and 14 point imported pages at the host and stop importing the reader code. The normaliser's one added rule (a reader-file reference, relative or on the host, reads as `API/<path>`) is in `api.py`, mirrored in `validate.js`; keep the two in step. The newsroom's release note v0.13.0 and card 036 describe the move from its side.

## Changing this site

Edit or add a page under `site/pages/` (markdown, or an `.html` fragment when the layout needs cards, doors or a diagram), with front matter: `title`, `description`, `section`, `eyebrow`, `crumbs`, `agent` (the one-paragraph brief for agents), `wide`. Then `python3 site/build.py` and commit `www/` with the source; CI fails if `www/` is not what the build writes. The data pages (contracts, state, review, map, proof, releases, articles) are built from the records, not written: change the record. Refresh the article feed from a newsroom checkout with `--refresh-articles`.

## What never to do

Edit anything under `releases/`. Move a tag. Load a reader file unversioned or by a relative path. Change a served file without a new release and a failing test. Add a third-party script to a reader page. Put a key, a read key or an access key in a file. Merge without a person's review.

