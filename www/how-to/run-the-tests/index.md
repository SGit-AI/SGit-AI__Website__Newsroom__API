# Run the tests

> The eleven test files, what each covers, how the harness serves a newsroom checkout and routes this host to the working tree, the three engines, which tests need Chromium, and how to run them against your own pages.

*api.newsroom.sgit.ai · v0.2.0 · this file is generated from the same source as <https://api.newsroom.sgit.ai/how-to/run-the-tests/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Run the tests

> No mocks of the code: real browsers, the real pages, a real vault library against a mock of the vault API, and the sgit command line. The harness swaps one thing only: requests to this host are answered from the working tree.

## Set up

```sh
git clone {{github}} && cd SGit-AI__Website__Newsroom__API
npm install --no-save --no-audit --no-fund playwright@1.56.1
npx playwright install --with-deps chromium        # and webkit, firefox, as you need
python3 -m pip install 'sgit-ai==0.21.0'           # the vault test's CLI round trip, the notes test's lane
git clone https://github.com/SGit-AI/SGit-AI__Website__Newsroom .newsroom   # the pages the tests run against
```

`tests/newsroom.json` names the commit CI checks the newsroom out at. `NEWSROOM=<path>` points the tests at any checkout, including your own site once it imports the code.

## Run

```sh
node tests/test_meter.mjs                       # Chromium, the default
BROWSER=firefox node tests/test_lists.mjs
BROWSER=webkit  node tests/test_search.mjs
NEWSROOM=/path/to/your/site node tests/test_meter.mjs
```

A test prints `ok` or `FAIL` per check and exits 1 on any failure. It prints `SKIP` and exits 0 when it cannot run (no browser, no newsroom checkout, no `sgit`); CI treats a `SKIP` as a failure, so a missing install cannot pass quietly.

## What each file covers

| Test | Covers | Engines |
|---|---|---|
| `test_styles` | the served stylesheets write no colour outside a theme token (the newsroom's rule, held here since the files moved) | Node |
| `test_meter` | the meter in a browser: depth, rating, decline, reload, below zero, the return page, personas, picks, export and restore, the share form, the persona links, phone width | all three |
| `test_lists` | the reading-list parser in Node and the two pages in a browser: malformed input, limits, the make page, copy, phone width | all three |
| `test_review` | the review's findings, pinned as the behaviour is today (R1 to R11, R14, R15, R17) | all three; R2 is held in Chromium |
| `test_wire` | the wire pages reading the real vault: edition, lenses, sources, documents, what left the browser | all three (needs the vault host) |
| `test_graphs` | the wire's graphs: the lenses' edges and the picture drawn from the real vault | all three (needs the vault host) |
| `test_sync` | the activity vault's logic as pure functions, two devices' states | all three (Node) |
| `test_search` | the index and the ranking in Node, the page in a browser | all three |
| `test_vault` | the vendored library against the mock, the newsroom's layer, the sgit CLI round trip | Node + CLI |
| `test_passkey` | the passkey lab with a virtual authenticator that has PRF | Chromium (CDP) |
| `test_pane` | the pane: the account carried between three devices through the mock | Chromium (CDP) |
| `test_notes` | the feedback loop end to end: notes, the lane, the CLI reading it, a second device | Chromium (CDP) |
| `test_inbox` | the pane's inbox and send: a link held, a QR code decoded, a second device | Chromium (CDP) |
| `test_ask` | ask: passages and messages in Node; the reader's key and the faked built-in model in a browser | Chromium |

Chromium's clipboard permissions have no equivalent in Firefox and WebKit, so the three clipboard reads run in Chromium only; the rest of each test runs everywhere.

## In CI

`.github/workflows/ci.yml` runs the syntax check, the manifest check and the reproducible build, then the tests in a matrix of the three engines against the pinned newsroom commit, on every push and pull request; about four minutes. The brief's target is two; caching the engines is the first thing to measure.

