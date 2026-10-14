# The components

> The served files by group, what each is for, where it came from, and which are frozen: SG Meter and its versions, the component base, the reading lists, subscribe, the vault layer and the pane, search and ask, the wire reader, the vendored vault library, the passkey lab.

*api.newsroom.sgit.ai · v0.1.0 · this file is generated from the same source as <https://api.newsroom.sgit.ai/docs/components/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# The components

> {{files}} files in the current release, {{bytes}} bytes, listed path by path in [the manifest](../../{{release}}/manifest.json). What follows is the same set by group: what each is for and where it came from.

## SG Meter: `assets/components/sg-meter/v1/`

| Version | Files | State |
|---|---|---|
| `v1.4/v1.4.0/` (`sg-meter.js`, `sg-meter-core.js`, `sg-meter.css`, `sg-meter.tpl`) | 4 | **the line that continues**: the newsroom's build of v1.3.1 without "Pause the meter" and "Start again", with the landing view for persona links |
| `v1.3/v1.3.1/`, `v1.3/v1.3.0/`, `v1.2/v1.2.0/`, `v1.1/v1.1.0/`, `v1.0/v1.0.0/` | 20 | frozen: published artefacts, served byte for byte, never edited; a page that pinned one keeps loading the same files |

`sg-meter.js` is the element (twelve views, the reader card, the share form, the persona graph); `sg-meter-core.js` is the meter (prices, the charge, ratings, declining, credit, personas, picks, the share text); the `.tpl` and `.css` are fetched beside it.

## The component base: `assets/components/base/v1/v1.0/v1.0.0/sg-component.js`

The contract a component follows: `static jsUrl = import.meta.url`, `get resourceName()`, `onReady()`, a `.tpl` and a `.css` beside the `.js`, published at an immutable versioned path. It fetches and caches the siblings and reports a failure as `<name>:error`.

## Reading lists: `for/`

`reading-list.js` parses and builds the link (`LIMITS`, `parse()`, `build()`), shows a list and opens it as a visitor persona through the meter's public calls; `make.js` is the page that makes and previews one; `for.css` styles both. [The grammar](../reading-list-link/).

## Subscribe and the share: `assets/subscribe.js`

The subscribe form: reads the contact file, checks the key's fingerprint, encrypts an `.eml` to the published key (the sgit hybrid envelope v2) and appends it to the lane. The meter's share view uses the same envelope.

## The vault layer: `assets/newsroom-vault.js`, `assets/door.js`, `assets/vault-pane/`

`door.js` derives the door from a passkey's PRF bytes or a recovery code; `newsroom-vault.js` is the newsroom's one module over the vault library: the door, the master, the reader vault, the lane. `vault-pane/` is the pane on every page that carries the meter: `vault-pane.js` the UI, `notes.js` the notes as records, `reading.js` what was read, `wire-state.js` the wire's lens and stories seen, `pending.js` what only this browser holds, `sync.js` the sync as pure functions, and its stylesheet.

## Search and ask: `assets/search/`

`search.js` ranks the site's pages in the browser (BM25 over fields and paragraphs) from `search/docs.json` and `search/text.json` that the site publishes; `ask.js` gives the top passages to Chrome's built-in model or to openrouter.ai with the reader's own key; `search-nav.css` is the Search link in every nav, `search.css` and `ask.css` the page.

## The wire reader: `wire/`

`vault-reader.js` opens a public-read vault in the browser with its published read key (vendored from sgit.ai's vault); `wire.js` draws the edition, the sources and the documents as text, never as markup; `wire.css`.

## The vendored vault library: `assets/vendor/sg-vault/`

`v0.2.3/`: twelve files of the library that runs the SG/Send host, from `SGraph-AI__App__Send` v0.2.3, never edited here; `VENDOR.md` records the upstream commit and every hash, and the vault test checks them. `local/sg-vault--create-with-id.js`: one extension pending upstream (create a vault at a chosen id).

## The passkey lab: `passkey/lab.js`, `lab.css`, `vectors.json`

The proofs of concept for [the passkey opens the vault](https://newsroom.sgit.ai/articles/the-passkey-opens-the-vault.html): a passkey with PRF, the door derivation written out, sgit's keys, a recovery code, test vectors against sgit's Python (`tools/passkey_vectors.py` writes them), and the door created on a vault server. A lab, not a feature; it moved because it is reader-run code with a test.

## What is not here, on purpose

The pages (the newsroom's), the content data (`articles/graphs.json`, `articles/ids.json`, `persona/links.json`, `search/*.json`, `wire/snapshot.json`), the contact file at `/.well-known/`, and the site's chrome (`site.js`, `shots.js`, `nav.js`). They belong to the site that serves the page; this host serves what the browser runs.

