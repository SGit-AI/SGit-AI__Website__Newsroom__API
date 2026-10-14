#!/usr/bin/env python3
"""The map of the newsroom's reader API, and its review: phase 0 of the move.

    python3 admin/build/api_map.py

The brief (articles/explorer-to-villager-newsroom.html, "0. Map") asks, before anything moves, for a map of
every file, capability, web control, input, place data leaves the browser, external call and configuration
value of everything a reader does on this site, as a table and as data, regenerated on every build. This
writes three things from one source:

    newsroom-api/index.html     the map and the review, for a person
    newsroom-api/map.json       the same, for an agent, a reviewer, or the repository the code moves to
    admin/notes/2026-10-11__newsroom-api-map-and-review.md   the review as a note

The mechanical part (files, sizes, hashes, exports, events, storage keys, fetch targets, the views each page
carries) is read from the tree on every run. The judgement (what each control does, what each input is,
the findings) is written here as data, next to the code it describes, so a change to the code is a reason to
change the line beside it. Findings that are bugs are pinned by admin/build/test_review.mjs, which records
the behaviour as it is, so that fixing one later is a visible change to a test.

The hashes are the "before" of the brief's rule 2 (same bytes served after the move): scripts, styles and
JSON raw; pages with the site chrome and version stamps normalised, as validate.js check 11 does.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from page import newsroom_page, write, esc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
HOST = (ROOT / "CNAME").read_text().strip()
VERSION = (ROOT / "admin/build/version.txt").read_text().strip()
METER = "assets/components/sg-meter/v1/v1.4/v1.4.1/"
DATE = "11 October 2026"

# ----------------------------------------------------------------------------------------------- the files
# (path, what it is, where it comes from). "sgit.ai, verbatim" files arrive byte for byte and cannot be changed
# by a rule of the import; "sgit.ai, rewritten" pages are imported and re-pointed; "this site" is written here.
FILES = [
    (METER + "sg-meter.js",        "SG Meter, the element: twelve views, the reader card, the share form, the graph", "this site, from sgit.ai's v1.3.1"),
    (METER + "sg-meter-core.js",   "SG Meter, the meter: prices, the charge, ratings, declining, credit, personas, picks, the share text", "this site, from sgit.ai's v1.3.1"),
    (METER + "sg-meter.css",       "SG Meter styles, adopted into the shadow root", "this site, from sgit.ai's v1.3.1"),
    (METER + "sg-meter.tpl",       "SG Meter markup (one div)", "this site, from sgit.ai's v1.3.1"),
    ("assets/components/base/v1/v1.0/v1.0.0/sg-component.js", "The component base: fetches the .tpl and .css beside a component and calls onReady()", "sgit.ai, verbatim"),
    ("for/reading-list.js",        "A reading list in a link: parse, build, show, open as a persona", "this site"),
    ("for/make.js",                "The page that makes a reading list and previews it", "this site"),
    ("for/for.css",                "Styles for the two reading-list pages", "this site"),
    ("assets/subscribe.js",        "The subscribe form: encrypts the address and posts it to the lane", "sgit.ai, verbatim"),
    ("wire/vault-reader.js",       "Reads an sgit vault in the browser with a published read key: ref, commit, tree, blobs, decrypted with Web Crypto; the markdown renderer", "this site, vendored from sgit.ai's vault-docs.js"),
    ("wire/graphs.js",             "The wires' graphs: a provenance strip per story, stories per day by beat, the threads on a date axis, the entities stories share, a sources tally, a story-by-persona matrix; SVG from the bundle, text nodes only, colours as theme tokens", "this site"),
    ("admin/build/infographics.py", "One card per story and one hero per edition through dev.tools.sgraph.ai, with a cost ledger per edition and per wire; the key from the environment only, a dry run without it", "this site"),
    ("wire/wire.js",               "The wires: the edition with its lens, release notes and corrections, a map or a stack when the vault has one, the sources, the documents, drawn from the vault as text; one code for every wire", "this site"),
    ("wire/wire.css",              "Styles for the wire pages", "this site"),
    ("wire/subscribe.js",          "Subscribe to one wire alone: the newsletter's envelope and lane (assets/subscribe.js, unedited), with X-SGit-List naming the wire", "this site"),
    ("admin/build/wire-reach.json", "The organisation routes this site found for each wire's reach page, under the published contact rules: page, date, hash, role addresses", "this site"),
    ("admin/build/wire-vault.json", "The Industry Wire's vault: endpoint, vault id, the public read key (the only kind of key on this site)", "this site"),
    ("admin/build/wire-vault.owasp.json", "The OWASP Wire's vault (wire/owasp/): the same contract, its own public read key", "this site"),
    ("admin/build/wire-vault.aws.json", "The AWS Wire's vault (wire/aws/): the same contract, its own public read key", "this site"),
    ("admin/build/wire-vault.portugal.json", "The Portugal Wire's vault (wire/portugal/): the same contract, its own public read key; the bundle is bilingual", "this site"),
    ("wire/snapshot.json",         "The Industry Wire as it was in the vault at the last release: headlines, primary links, corrections, the latest release note; the fallback and the agents' index", "this site, generated"),
    ("wire/owasp/snapshot.json",   "The OWASP Wire at the last release, the same shape", "this site, generated"),
    ("wire/aws/snapshot.json",     "The AWS Wire at the last release, the same shape, with the stack's deadlines", "this site, generated"),
    ("wire/portugal/snapshot.json", "The Portugal Wire at the last release, the same shape, with each headline in Portuguese too", "this site, generated"),
    ("assets/vault-ui-embed.js",   "The study page: embeds the vault browser from dev.vault.sgraph.ai and hands it a read key", "sgit.ai, verbatim"),
    ("assets/shots.js",            "Figures: sets each image's address at runtime", "sgit.ai, verbatim"),
    ("assets/site.js",             "Page behaviour: nav, copy buttons, reveal-on-scroll", "sgit.ai, verbatim"),
    ("assets/nav.js",              "Nav behaviour on the pages this site writes", "this site"),
    (".well-known/sgit-subscribe.json", "The lane and the public key the share and the subscription are encrypted to and written into", "sgit.ai, verbatim"),
    ("articles/ids.json",          "A number for every article: the contract reading lists are built on", "this site, generated"),
    ("persona/links.json",         "The persona links, for whoever writes to someone", "this site, generated"),
    ("articles/graphs.json",       "The feed the picks and the graph read: every article with topics, tags and citations", "sgit.ai, imported"),
    ("assets/newsroom-vault.js",   "The newsroom's vault module: create, open, read, write and publish through the vendored library; the door, master and reader vaults; unlock; add a door", "this site"),
    ("assets/door.js",             "From a passkey's PRF bytes (or a recovery code) to a door vault's key: the article's derivation, shared by the lab and the pane", "this site"),
    ("assets/vault-pane/vault-pane.js", "The vault pane on every page with the meter, in three tabs: this page (the notes, send to the newsroom, the lane's read key), the vault (enable with the passkey, create or join, update the vault, the table across devices, bring their activity here), the keys (every vault of the account)", "this site"),
    ("assets/vault-pane/notes.js",  "The reader's notes as records: one tap at a piece (done, read later, not for me, more like this, liked, wrong, fix this, idea) with words and the selected phrase, kept in localStorage sgit.notes.v1; keep, add words, remove, mark sent; the decision at a page", "this site"),
    ("assets/search/search.js", "Search in the browser: the index from search/docs.json and search/text.json, BM25 over fields and paragraphs, phrases, numbers, prefixes, snippets; the search page", "this site"),
    ("assets/search/search.css", "Styles for the search page", "this site"),
    ("assets/search/ask.js", "Ask: the top passages, numbered, given to Chrome's built-in model or to openrouter.ai with the reader's own key, answered with citations; the key in the tab unless kept", "this site; openrouter.ai, only with the reader's key"),
    ("assets/search/ask.css", "Styles for Ask on the search page", "this site"),
    ("assets/vault-pane/inbox.js", "The inbox (049): the reader's RSA-OAEP key pair, the link (sgi1.<vault>.<token>.<key>), sgit's hybrid envelope, the append routes (configure, write, list, fetch, mark-processed), the drain, the QR code", "dev.send.sgraph.ai /api/vault/append/*"),
    ("assets/vault-pane/send.js", "The sending side of the inbox, for a browser with the link and no passkey: its own records as one device file, sealed and appended", "dev.send.sgraph.ai /api/vault/append/write"),
    ("assets/vendor/qrcode-generator/2.0.4/qrcode.mjs", "QR code generator (Kazuhiko Arase, MIT), vendored unchanged, for the inbox link", "this site"),
    ("assets/search/search-nav.css", "The Search link in the nav, on every page", "this site"),
    ("assets/vault-pane/wire-state.js", "What this browser knows about the wire: stories seen and when, the visit, the lens chosen; and which of the vault's releases to show", "this site"),
    ("assets/vault-pane/pending.js", "What this browser holds that the reader vault does not yet: reads, top-ups, notes and stories seen since the last update", "this site"),
    ("assets/vault-pane/reading.js", "What this browser knows about what it has read, from the meter's records: one page summed up (times, when, how far, cost, rating) and the reading history", "this site"),
    ("assets/vault-pane/sync.js",  "The activity vault's logic as pure functions: a device's file (reads, top-ups, personas, notes), the consolidated view, totals recomputed, merging into local state", "this site"),
    ("assets/vault-pane/vault-pane.css", "Styles for the pane, its tabs, the chips and the notes, and the page shift", "this site"),
    ("assets/vendor/sg-vault/local/sg-vault--create-with-id.js", "SGVault.createWithId: a vault at a derived id, a local patch pending upstream", "this site, pending upstream"),
] + [
    (f"assets/vendor/sg-vault/v0.2.3/{f}", d, "SGraph-AI__App__Send v0.2.3, vendored and unedited (VENDOR.md)") for f, d in [
        ("sg-send/sg-send-crypto.js", "AES-256-GCM and PBKDF2 over Web Crypto"),
        ("sg-send/sg-send.js", "The HTTP client: read, write, batch, presigned; x-sgraph-access-token"),
        ("sg-vault/sg-vault-crypto.js", "Key derivation: read key, write key, ref and index ids; key prefixes"),
        ("sg-vault/sg-vault-object-store.js", "Content-addressed objects, the write batch, the block caches"),
        ("sg-vault/sg-vault-ref-manager.js", "Refs and the branch index; write-if-match"),
        ("sg-vault/sg-vault-commit.js", "Commits and trees, every field encrypted"),
        ("sg-vault/sg-vault.js", "SGVault: create, open, openReadOnly, the tree, the commit"),
        ("sg-vault/sg-vault--file-ops.js", "addFile, updateFile, getFile, removeFile, renameFile, moveFile"),
        ("sg-vault/sg-vault--folder-ops.js", "Folders, lazy sub-trees"),
        ("sg-vault/sg-vault--sync.js", "push, pushIfMatch, pull, merge, ahead and behind"),
        ("sg-vault/sg-vault--history.js", "History: commits, trees and files at a commit"),
        ("sg-vault/sg-vault--branches.js", "Branches from the index"),
    ]
]
PAGES = [
    ("account/index.html", "the reading account"), ("account/newsroom.html", "the reader's newsroom"),
    ("account/personas.html", "the personas"), ("account/share.html", "send us your reading"),
    ("account/top-up.html", "the top-up"), ("account/topped-up.html", "the page a payment returns to"),
    ("subscribe/index.html", "subscribe"), ("persona/index.html", "the persona picker"),
    ("persona/founder/index.html", "a persona link"), ("persona/journalist/index.html", "a persona link"),
    ("persona/security/index.html", "a persona link"), ("persona/builder/index.html", "a persona link"),
    ("persona/board/index.html", "a persona link"), ("for/index.html", "a reading list"), ("for/make.html", "make a reading list"),
    ("wire/index.html", "the Industry Wire's edition"), ("wire/sources.html", "the wire's sources"), ("wire/how.html", "how the wire is read, and its documents"),
    ("wire/owasp/index.html", "the OWASP Wire's edition, with the projects graph"), ("wire/aws/index.html", "the AWS Wire's edition, with the stack and its deadlines"),
    ("wire/portugal/index.html", "the Portugal Wire's edition, in English and Portuguese, with the ecosystem map"), ("wire/days.html", "every wire day by day"), ("wire/charter.html", "the charter of the wires"), ("wire/desk-brief.html", "the brief for the desks"), ("wire/reach.html", "who should know, by organisation route"),
    ("vault/index.html", "your vault: the reading account carried between devices, with the pane open"),
    ("meter/index.html", "SG Meter, documented"), ("meter/security.html", "the meter's security model"),
    ("demos/vaults/newsroom-synthetic-users/index.html", "the synthetic-readers study, with the embedded vault"),
]
BUILD = [
    ("admin/build/ids.py", "assigns article numbers, writes articles/ids.json"),
    ("admin/build/lists.py", "writes the two reading-list pages"),
    ("admin/build/personas.py", "writes the persona pages and persona/links.json"),
    ("admin/build/page.py", "the page template, with the meter block every page this site writes carries"),
    ("admin/build/sync_newsroom.py", "the import: re-points the meter to v1.4.1, applies the text rules, prints the article number"),
    ("admin/build/newsroom-meter.json", "the top-up link, applied on import"),
    ("admin/build/newsroom-text.json", "the ten text rules, applied on import"),
    ("admin/build/wire.py", "writes the three pages of every wire (wire/, wire/owasp/, wire/aws/) and, from a clone, each wire's snapshot.json"),
    ("admin/build/vault_page.py", "writes the vault page"),
    ("admin/build/lane.py", "the newsroom's end of the feedback loop: clones or pulls a reader's lane with its read key (from the environment, never a file) and prints the notes by page"),
    ("admin/build/search_index.py", "writes search/docs.json, search/text.json and the search page from the published pages, the article graphs and versions, the wires' snapshots and the notes"),
    ("admin/build/engineering.py", "renders /engineering/ from admin/engineering/: the board, one page per issue card, one per release, issues.json"),
    ("admin/build/md.py", "the small markdown renderer the engineering pages use; escapes everything first"),
    ("admin/build/chrome.py", "the nav and footer on every page, with the meter's balance and the Vault button and pane on pages that carry the meter"),
    ("admin/build/validate.js", "the gate: checks 2d (live link), 5 (key tripwire), 11 (imports unedited), 12 (numbers hold)"),
]
LABS = [("passkey/lab.js", "The passkey lab: WebAuthn with PRF, the door derivation, sgit's key derivation, and real vaults through assets/newsroom-vault.js"),
        ("passkey/lab.css", "its styles"), ("passkey/vectors.json", "its test vectors, from sgit's Python"), ("passkey/index.html", "the page")]
TESTS = [("admin/build/test_meter.mjs", "the meter in Chromium"), ("admin/build/test_lists.mjs", "the parser in Node and the list pages in Chromium"),
         ("admin/build/test_review.mjs", "the review's findings, pinned as the behaviour is today"),
         ("admin/build/test_passkey.mjs", "the passkey lab in Chromium, with a virtual authenticator that has PRF, against the mock of the vault API"),
         ("admin/build/test_wire.mjs", "every wire's pages in Chromium, each reading its real vault"),
         ("admin/build/test_vault.mjs", "real vaults in Node: the vendored library against the mock of the vault API, and the sgit CLI round trip"),
         ("admin/build/test_sync.mjs", "the activity vault's logic in Node, with two devices' states"),
         ("admin/build/test_pane.mjs", "the vault pane in Chromium: the reading account carried between two devices through the mock vault, and a third opened with the recovery code"),
         ("admin/build/test_search.mjs", "search: the index and the ranking in Node, the page in Chromium"),
         ("admin/build/test_ask.mjs", "ask: the passages and the messages in Node; no model, the reader's key (openrouter.ai answered by a route) and the built-in model (faked) in Chromium"),
         ("admin/build/test_inbox.mjs", "the inbox: the link, the envelope, the refusals in Node; a browser with a passkey and one without, the QR code decoded, the drain and a new link, in Chromium against the mock with the append routes"),
         ("admin/build/test_notes.mjs", "the feedback loop in Chromium: notes on an article and at a wire story, carried by the vault, sent to the lane, read by the sgit CLI and lane.py with the read key alone, brought into a second device"),
         ("admin/build/vault-mock.mjs", "the mock of the vault API the two vault tests run against")]

# ----------------------------------------------------------------------------------------------- the views and controls
# What a reader can click, type or pay, per view, and the call it makes. Read from sg-meter.js; a change there is a change here.
CONTROLS = [
    ("balance", "every page (the nav chip)", [("link", "the balance", "opens the account page")]),
    ("page", "every charged page, at the foot", [
        ("link", "How paying for reading works here", "opens links.how"),
        ("link", "Balance", "opens the account page"),
        ("button", "+ Add to your reading list / ✓ In your reading list", "meter.curate(slug, 'on' | '')"),
        ("5 buttons × 3", "How useful was this? · More like this? · Level of detail", "meter.rate(field, 1–5); usefulness re-prices the page"),
        ("link", "Your newsroom", "opens links2.newsroom"),
        ("button", "Something wrong with this page? Don’t charge me", "shows the four reasons"),
        ("4 buttons", "the reasons", "meter.decline(reason): refunds the page"),
    ]),
    ("account", "account/index.html", [
        ("link", "Top up £5.00", "navigates to the Stripe payment link (topup.link)"),
        ("button", "Export as JSON", "downloads reading-account.json (the whole state)"),
        ("links", "Your newsroom · Your personas · Send us your reading", "own pages"),
        ("links", "one per history row", "the page read, from the log's own path"),
        ("file input", "Restore from an export…", "confirm(), then meter.restore(text)"),
    ]),
    ("topup", "account/top-up.html", [("link", "Pay £5.00", "navigates to the Stripe payment link; with no link, the simulated cart")]),
    ("topped-up", "account/topped-up.html", [("on load", "?session_id=…", "meter.credit(amount, 'link', id), once per id, unverified"), ("link", "Your account", "")]),
    ("picks", "the front page", [("links", "one per pick", "opens the article")]),
    ("newsroom", "account/newsroom.html, and under a persona banner", [
        ("buttons", "the persona chips", "meter.setActive(id)"), ("link", "+ Add or manage personas", "the personas page"),
        ("link", "A newsroom designed for you", "the share page (not when compact)"),
        ("2 buttons per pick", "Add to reading list · Not for this persona", "meter.curate(slug, 'on' | 'off', active)"),
        ("button per kept / put-out article", "remove · bring back", "meter.curate(slug, '')"),
        ("buttons", "Add this persona (per preset) · Add a blank persona", "meter.addPersona(preset | '')"),
    ]),
    ("personas", "account/personas.html", [
        ("input + button per persona", "name · Rename", "meter.renamePersona(id, name)"),
        ("button per persona", "Make active", "meter.setActive(id)"), ("link per persona", "Open its newsroom", "setActive, then the newsroom page"),
        ("button per persona", "Remove", "confirm(), then meter.removePersona(id)"), ("buttons", "the preset cards", "meter.addPersona"),
    ]),
    ("graph", "account and newsroom pages", [("links", "one per article dot", "opens the article")]),
    ("link", "pages that carry it", [("link", "Your newsroom", "")]),
    ("landing", "persona/index.html and persona/<id>/", [
        ("on load", "the persona named by the attribute or the #fragment", "meter.visit(id): added as a visitor, made active, nothing charged"),
        ("buttons", "Keep this persona · Remove it", "meter.keepPersona(id) · meter.removePersona(id)"),
        ("button", "Read as <name> again", "meter.visit(id) after a removal"),
        ("links", "Your personas · Other personas", "own pages"),
        ("per preset (the picker)", "Read as this persona · Copy link", "opens persona/<id>/ · clipboard"),
    ]),
    ("share", "account/share.html", [
        ("button", "Copy to clipboard · Copy it instead", "clipboard; meter.noteShared('copied')"),
        ("inputs", "name · email (required) · note · consent · newsletter · a hidden honeypot", "the form; nothing is sent without consent"),
        ("submit", "Send it, encrypted", "fetch the contact file, verify the key's fingerprint, encrypt an .eml, POST to the lane"),
    ]),
    ("reading list (for/)", "for/index.html", [
        ("on load", "the fields after the #", "parse(); visitList(): a visitor persona named for the two people, its articles as the reading list"),
        ("link", "Start reading", "the first article"), ("link", "Reply to <sender>", "mailto:, only when the link carries e="),
        ("buttons", "Keep this list as a persona · Remove it · Add it again", "meter.keepPersona · meter.removePersona · visitList"),
        ("links", "every article, every persona or collection to follow", "own pages"),
    ]),
    ("make a reading list", "for/make.html", [
        ("inputs", "From · To · a note · your email", "validated as the recipient's page validates them"),
        ("search and two selects", "title, topic or number · topic · persona", "filters the article list"),
        ("2 buttons per article", "Read · Look", "puts the article in a group"),
        ("per chosen article", "↑ · ↓ · To look / To read · Remove, and drag", "orders the list"),
        ("checkboxes", "personas and collections to follow", ""),
        ("button", "Copy link", "clipboard"), ("link", "Open as the recipient", "for/#… in a new tab"),
        ("input + button", "Edit an existing link · Load", "parse() into the form"), ("button", "Clear the list", ""),
    ]),
    ("subscribe form", "subscribe/index.html", [
        ("inputs", "email · name · consent · a hidden honeypot", ""),
        ("submit", "Subscribe", "fetch the contact file, verify the fingerprint, encrypt an .eml, POST to the lane; on failure, a mailto: link with the same text"),
    ]),
    ("the study page", "demos/vaults/newsroom-synthetic-users/", [("on load", "two iframes from dev.vault.sgraph.ai", "the published read key is handed over postMessage; the vault is decrypted in the frame")]),
    ("article foot", "every article", [("link", "start a reading list with it", "for/make.html#r=<number>")]),
]

# ----------------------------------------------------------------------------------------------- inputs, storage, outputs
INPUTS = [
    ("Element attributes", "view · kind · date · topics · title · quiet · count · persona · compact", "the page's own markup (trusted: it is this site's build)", "sg-meter.js"),
    ("The page's config", '<script type="application/json" id="sg-meter-config">', "this site's build, written once per page; every key has a default", "sg-meter-core.js _config()"),
    ("The address: query", "?session_id= on account/topped-up.html", "whoever made the link; any value is credited once (accepted, documented)", "_toppedUp()"),
    ("The address: fragment", "#<persona id> on persona/; #from,to,r,s,f,n,e on for/ and for/make.html", "whoever made the link; validated field by field, the rest dropped and listed", "_named(), reading-list.js parse()"),
    ("The address: path", "location.pathname", "the charge is keyed on it; the slug is taken from it; the share records it", "open(), _page(), _send()"),
    ("Local storage", "sgit.meter.v1 (the state), sgit.meter.v1.seen (session: the charge per path)", "this browser, written by the meter; also by the reader, who may edit it (accepted)", "_read(), _seen()"),
    ("A file", "Restore from an export…", "whoever made the file; checked for balance:number and log:array only", "restore()"),
    ("Forms", "the share form, the subscribe form, the make page", "the reader; email checked by a loose pattern, names by a strict one", "_send(), subscribe.js, make.js"),
    ("The wires' vaults", "data/bundle.json (with wire, map or stack when the vault has them), data/deliveries.json, data/releases.json, docs/*.md, decrypted in the browser; one vault per wire", "whoever holds the vault's write key (the wire's agents); drawn as text, links only from http(s) values, markdown rendered by an escaping renderer; the vault's own HTML is not used", "wire/wire.js"),
    ("Own-origin data", "articles/graphs.json · articles/ids.json · .well-known/sgit-subscribe.json · sg-meter.tpl · sg-meter.css", "this site's build; the contact file's key is checked against its fingerprint", "feed(), openList(), _send()"),
    ("postMessage", "replies from the dev.vault.sgraph.ai frames", "origin-checked; drives a status line only", "vault-ui-embed.js"),
]
STATE = [
    ("v", "3"), ("created", "ISO time"), ("balance · spent · declined", "pence, to 0.1p"), ("reads", "pages opened"),
    ("paused", "always false since v1.4.0"), ("log[]", "≤ 500 entries: id, at, path, title, kind, topics, price, depth, cost, persona, autoKept?, rating{useful,more,detail,at}?, declined{reason,at,refunded}?"),
    ("topups[]", "ref (≤ 40 chars), at, credit, source: link | simulated"), ("sessions[]", "every payment reference credited, unbounded"),
    ("cart[]", "the simulated cart (unused with a live link)"), ("active", "the active persona's id"),
    ("personas[]", "id, preset, name, created, on[], off[], visitor?, list? (a reading list's key), theme?"), ("shares[]", "≤ 20: at, how, pages"),
]
OUTPUTS = [
    ("GET, own origin", "every page, script, style, image and JSON", "whenever a page opens", "GitHub Pages, which sees the request as any host does"),
    ("POST https://dev.send.sgraph.ai/api/vault/append/write/y9j3nc60", "{append_token, payload}: an .eml encrypted in the browser to the lane's public key", "when the reader presses Send on the share page or Subscribe", "the vault host; it sees ciphertext, a size and a time"),
    ("Navigation to https://buy.stripe.com/…", "the reader leaves for Stripe's page and returns to /account/topped-up.html?session_id=…", "when the reader presses Top up / Pay", "Stripe (card, email, name, postcode)"),
    ("GET https://dev.send.sgraph.ai/api/vault/read/u9i9jp0l/…", "the ciphertext of the wire's vault: its head pointer, commit, tree and the files the page needs, decrypted in the browser with the published read key", "when a wire page opens, and when the reader asks for a new commit; the pointer at most every two minutes", "the vault server; it sees the request and nothing of the reader"),
    ("iframe https://dev.vault.sgraph.ai/?embed=1", "two frames; the published read key is posted to them", "on the study page only", "the vault UI host"),
    ("mailto:", "Reply to <sender> on a reading list; the subscribe fallback", "when pressed; the page sends nothing", "the reader's mail client"),
    ("A download", "reading-account.json: the whole state, payment references included", "Export as JSON", "the reader's disk"),
    ("The clipboard", "a link, or the share text", "Copy", "the reader's clipboard"),
    ("postMessage to the parent window", "{type:'sg-app-ready'} with targetOrigin *", "when a page is framed", "whoever framed it"),
]

# ----------------------------------------------------------------------------------------------- the contracts
CONTRACTS = [
    ("The meter config", "storageKey, start, newDays, symbol, prices{article_new,article,issue,note,collection,page,free}, depth, minDepth, topup{amount,link}, packs, links{account,topup,how}, rating{price[5],more[5]}, autoKeep, picks{feed,base}, links2{newsroom,personas,share}, share{contact,form,site,max}, personas{presets[],names{}}, root", "sg-meter-core.js DEFAULTS; written into every page by sgit.ai's build and re-pointed by the import"),
    ("A charged page", '<sg-meter view="page" kind="article|issue|note|collection|page|free" date="…" topics="a b" title="…" [quiet]>: the price class comes from the page', "sgit.ai's build for imported pages; page.py (kind=free, quiet) for this site's"),
    ("A persona link", "/persona/<id>/ and /persona/#<id>, id ∈ {founder, journalist, security, builder, board}", "personas.py, persona/links.json"),
    ("A reading list link", "/for/#from=&to=&r=&s=&f=&n=&e=: names ≤ 40 chars of letters, spaces, hyphens, apostrophes; r,s article numbers, 1–50 in all; f persona ids or c:<collection>, ≤ 10; n ≤ 240 chars; e an address", "for/reading-list.js LIMITS, parse(), build()"),
    ("Article numbers", "articles/ids.json: n and slug are the contract, assigned once in publication order, never changed or reused; every other field is display text", "admin/build/ids.py; validate.js check 12"),
    ("The return page", "?session_id=<ref>: credited once per distinct value, never verified", "_toppedUp(), credit()"),
    ("The export", "the state as JSON; restore accepts any file with balance:number and log:array", "restore()"),
    ("The share", "a text summary then the same data as JSON {v:1, site, at, balance, spent, declined, reads, topups, active, personas, topics, cols, log}, as an .eml with X-SGit-Form, X-SGit-Reply-To, X-SGit-Name, X-SGit-Subscribe, X-SGit-Page", "shareData(), _send()"),
    ("The envelope", "sgit hybrid envelope v2: {v:2, w, i, c} (RSA-OAEP-SHA256 wrapped AES-256-GCM key, iv, ciphertext), base64, then base64 again as the lane payload", "envelope(), subscribe.js encrypt()"),
    ("The contact file", "sgit-subscribe/v1: recipient{address, fingerprint, encrypt}, inbox{vault, endpoint, encrypt_to, status, lane{name, append_token}}; the fingerprint is recomputed from the PEM before use", ".well-known/sgit-subscribe.json"),
    ("The wires' vaults", "u9i9jp0l (the Industry Wire), eitf274v (OWASP), v202bla5 (AWS), p6twygul (Portugal) on dev.send.sgraph.ai, read keys published; data/bundle.json {beats, stories, sources, personas, brief; wire, map, stack when present}, data/deliveries.json, data/releases.json (wire-releases/v1, one entry per publish), docs/*.md; story fields, changes and status shown as written; everything in a vault is public, for ever", "admin/build/wire-vault*.json; wire/how.html; each wire's agents own its content"),
    ("Events", "sg:meter.changed · charged · rated · declined · toppedup · reset · restored · persona · shared; sg-meter:error", "sg-meter-core.js _emit(), sg-component.js failed()"),
    ("A component", "static jsUrl, get resourceName(), onReady(); a .tpl and a .css beside the .js; published at an immutable versioned path", "sg-component.js"),
    ("The import's rules", "the meter path rewrite (v1.3.1 → v1.4.1), the top-up link, ten text rules, the article number line, the moved banner cut, the foot of every issue; each stops the import when its anchor moves", "sync_newsroom.py items 9–15"),
]

# ----------------------------------------------------------------------------------------------- the review
# id, severity, area, finding, evidence, pinned by (a test in test_review.mjs, or how it is recorded), proposed change
FINDINGS = [
    ("R1", "medium", "the meter's logic",
     "Declining a page as “not relevant” leaves it in the persona's reading list. open() auto-keeps an article on first open; decline() refunds the charge but does not undo the auto-keep, so the article stays under “Its reading list” and profile() adds +5 for it while the decline subtracts 2: a page the reader rejected pulls its topics up.",
     "sg-meter-core.js open() [autoKeep], decline(); seen in a browser on 11 October", "test_review.mjs R1 (passes while the article stays in the list)",
     "decline() removes an autoKept entry from the active persona's on[]; a reader who added it by hand keeps it"),
    ("R2", "low", "restore from a file",
     "restore() checks that the file has a numeric balance and a log array and nothing else. A persona without on[] and off[] makes the personas and newsroom views throw and show nothing; a log entry's path is rendered as the history link's href as it is; a persona's theme is written into a style attribute as it is. The file is the reader's own, so the exposure is a file someone else sent them to restore.",
     "sg-meter-core.js restore(), _read(); sg-meter.js _account() history rows, _chip() style", "test_review.mjs R2 (the blank personas page); the href and theme cases are described, not pinned",
     "normalise on read: personas get arrays, paths must be same-origin paths, themes must be a hex colour; unknown fields dropped"),
    ("R3", "low", "the return page",
     "A malformed percent sequence in ?session_id= (for example %E0%A4%A) makes decodeURIComponent throw inside onReady, so the element fails with “did not load: URI malformed” instead of saying the reference is missing.",
     "sg-meter.js _toppedUp()", "test_review.mjs R3",
     "try/catch around the decode; treat an undecodable id as no id"),
    ("R4", "medium", "data correctness",
     "A reading share or a subscription sent from this site is labelled sgit.ai: the imported config has share.site = \"sgit.ai\" (so the text begins “My reading on sgit.ai”), subscribe.js writes From: site@sgit.ai, and the contact file says site: sgit.ai. The agent that drains the lane can tell the two sites apart only by the Sent from line.",
     "index.html sg-meter-config share.site; assets/subscribe.js eml(); .well-known/sgit-subscribe.json", "test_review.mjs R4",
     "a recorded meter rule for share.site (admin/build/newsroom-meter.json); subscribe.js and the contact file are verbatim imports and need this site's own copies, or a parameter, after the move"),
    ("R5", "note", "operations",
     "On the live site the lane for shares and subscriptions is on dev.send.sgraph.ai and the study page's vault frames come from dev.vault.sgraph.ai. Both hosts are named “dev”. Production reader data goes to them.",
     ".well-known/sgit-subscribe.json inbox.endpoint; assets/vault-ui-embed.js ORIGIN", "test_review.mjs R5 (records the hosts)",
     "a decision, not a code change: either these are the production hosts and say so, or the files point at production ones"),
    ("R6", "low", "display",
     "Money is kept to a tenth of a penny and shown to a penny. Balance and spent are each formatted on their own, so a half-penny state shows, from £5.00, a balance of £4.95 and £0.06 spent, which do not add up; the history shows 5.5p. A reader who checks the arithmetic finds a penny missing.",
     "sg-meter-core.js money(), r1(); seen with balance 494.5", "test_review.mjs R6",
     "one rounding rule for the pair (format spent as start − balance, or keep both to 0.1p on the account page)"),
    ("R7", "question", "picks",
     "picks() excludes every page in the log, whichever persona read it, while profile() is per persona. An article read as Morgan is never picked for Rowan.",
     "sg-meter-core.js picks()", "test_review.mjs R7 (records the behaviour)",
     "decide: per-persona exclusion, or keep and say so on the newsroom page"),
    ("R8", "low", "robustness",
     "feed() caches a failed fetch as null for the life of the page, so one transient failure leaves “The list of articles could not be loaded” on every view until a reload.",
     "sg-meter-core.js feed()", "test_review.mjs R8",
     "do not cache a failure; retry on the next call"),
    ("R9", "medium", "the number contract",
     "If sgit.ai renames an article (a new slug), ids.py marks the old number withdrawn and gives the article a new number. A reading list that named the old number then says the article is no longer published, although it is.",
     "admin/build/ids.py assign()", "described; a rename has not happened yet",
     "a renamed_to field on the old entry, followed by the list page; the gate requires it when a slug disappears and a new one appears in the same import"),
    ("R10", "high for the move", "Content-Security-Policy",
     "Every imported page loads assets/site.js, subscribe.js and shots.js by fetching the text and running it with (0, eval)(text) (the loader's bridge path), and the loader and the meter config are inline. A script-src policy without 'unsafe-eval' and without hashes breaks every page. frame-ancestors cannot be set in a meta tag at all, and GitHub Pages sets no headers, so framing (the Keep, Remove and Top up buttons under another site) is not prevented today.",
     "the loader IIFE on every imported page; subscribe/index.html", "test_review.mjs R10 (counts the pages that eval)",
     "load scripts with <script src> or import(); then a meta CSP for script-src and connect-src; frame-ancestors needs a host that sets headers"),
    ("R11", "high per the brief", "the pipeline",
     "The one workflow ran validate.js only; the browser tests (46 + 65 checks) never ran in CI.",
     ".github/workflows/deploy-pages.yml", "fixed in this release: a reader-tests job runs all three test files before the tag",
     "done; the move's pipeline adds WebKit and Firefox and a pre-production copy"),
    ("R12", "note for the move", "two upstreams",
     "The account pages, subscribe, the contact file and the component base are imported from sgit.ai on every sync and cannot be changed here except by a recorded rule, and verbatim files (scripts, JSON) cannot be changed by rule at all. R4 is the first consequence. The newsroom's meter is v1.4.0 while sgit.ai's is v1.3.1.",
     "sync_newsroom.py VERBATIM, MOVED_DIRS", "the brief's phase 1 removes it",
     "the move: both sites pin released files"),
    ("R13", "note", "what leaves",
     "The export includes the payment references (sessions, topups[].ref) that the share deliberately leaves out. A reader who sends their export instead of their share sends them.",
     "sg-meter.js _export(); shareData()", "described",
     "say so beside the button, or export without sessions"),
    ("R14", "low", "bounds",
     "sessions[] and topups[] grow without bound, and a payment reference is not checked for shape before it is stored.",
     "sg-meter-core.js credit()", "described",
     "cap both; keep references that look like cs_… only"),
    ("R15", "low", "personas",
     "persona(id) falls back to personas[0], which is “me” only when “me” is first; after a restore that puts another persona first, an unknown id resolves to that persona.",
     "sg-meter-core.js persona(), _read()", "described",
     "fall back to the persona with id me"),
    ("R16", "process", "caching",
     "Imported pages load the meter as sg-meter.js?v=<sgit.ai's release>, so the cache-buster never changes for a release of this site. That is fine while a published version is never edited in place, which is the rule; it is written here because v1.4.0 was edited in place while it was being built.",
     "the import's own_meter() keeps sgit.ai's ?v=", "described",
     "a change is a new version path, always"),
    ("R17", "note", "reading lists",
     "A list's persona is keyed by a 32-bit hash of the names and numbers, so two different lists can share one persona with probability about one in four billion per pair.",
     "for/reading-list.js listKey()", "described", "a longer hash, or the fragment itself as the key"),
    ("R18", "note", "listeners",
     "The landing view adds a window hashchange listener per element and never removes it, and re-renders on every meter change (the picker's “Copied” label resets).",
     "sg-meter.js _landing()", "described", "one listener, removed on disconnect"),
]
ACCEPTED = [
    ("The return page credits any session id", "a static page cannot verify a payment; building the address by hand credits the reader's own screen", "meter/security.html"),
    ("The reader can edit their own balance", "the state is in their storage; nothing is behind a wall", "meter/security.html, No server by design"),
    ("The names in a reading list are whatever the link says", "there is no signature yet; a signed list is a later step on RFC 0001's keys", "for/index.html"),
    ("A page is charged by the deepest point reached, and the reader card is at the foot", "reaching the card to rate a page is reading to the end", "going-live-with-the-reading-meter.html"),
]

# ----------------------------------------------------------------------------------------------- the mechanical scan
NORMALISE = [
    (re.compile(r'<nav class="site">[\s\S]*?</nav>'), '<nav class="site"></nav>'),
    (re.compile(r'<footer class="site">[\s\S]*?</footer>'), '<footer class="site"></footer>'),
    (re.compile(r'<span class="llmschip-m">[^<]*</span>'), '<span class="llmschip-m"></span>'),
    (re.compile(r'· site v\d+\.\d+\.\d+ ·'), '· site ·'),
    (re.compile(r'<span>newsroom\.sgit\.ai &middot; v\d+\.\d+\.\d+</span>'), '<span>newsroom.sgit.ai &middot; </span>'),
]


def sha(path):
    data = (ROOT / path).read_bytes()
    if path.endswith((".html", ".md")):
        text = data.decode("utf-8")
        for rx, repl in NORMALISE:
            text = rx.sub(repl, text, count=1)
        data = text.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def lines(path):
    p = ROOT / path
    return sum(1 for _ in p.open(encoding="utf-8", errors="replace")) if p.exists() else 0


def scan(path):
    """What a file reaches for: fetch targets, hosts, storage, events, eval, innerHTML."""
    t = (ROOT / path).read_text(encoding="utf-8", errors="replace")
    if path.endswith(".json") and not path.startswith(".well-known/"):
        return {"hosts": [], "fetch": 0, "storage": [], "events": [], "eval": 0, "innerHTML": 0, "confirm": 0, "crypto": False}   # data, not code
    return {
        "hosts": sorted(set(re.findall(r"https?://([a-z0-9.-]+\.[a-z]{2,})", t)) - {"www.w3.org", "schema.org", "sgit.ai", "newsroom.sgit.ai", "coding.sgit.ai", "github.com", "vault.sgraph.ai", "tools.sgraph.ai", "riskmandate.ai", "pt.newsroom.sgit.ai", "secrets.sgit.ai"}),
        "fetch": len(re.findall(r"\bfetch\(", t)),
        "storage": sorted(set(re.findall(r"(localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)", t))),
        "events": sorted(set(re.findall(r"sg:meter\.[a-z]+", t)) | set(re.findall(r"`\$\{this\.resourceName\}:error`", t) and ["sg-meter:error"] or [])),
        "eval": len(re.findall(r"\beval\(", t)),
        "innerHTML": len(re.findall(r"\.innerHTML\s*=", t)),
        "confirm": len(re.findall(r"\bconfirm\(", t)),
        "crypto": bool(re.search(r"crypto\.subtle", t)),
    }


def views_on_pages():
    out = {}
    for p in ROOT.rglob("*.html"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("archive/", "summit-archive/", "vault-app/", ".claude/")):
            continue
        for v in re.findall(r'<sg-meter view="([a-z-]+)"', p.read_text(encoding="utf-8", errors="replace")):
            out.setdefault(v, set()).add(rel)
    return {v: sorted(s) for v, s in sorted(out.items())}


def loader():
    t = (ROOT / "account/index.html").read_text(encoding="utf-8")
    m = re.search(r"<script>\s*(\(function\(\)\{var R=.*?)</script>", t, re.S)
    code = m.group(1) if m else ""
    pages = 0
    for p in ROOT.rglob("*.html"):
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("archive/", "summit-archive/", "vault-app/", ".claude/")):
            continue
        if "(0,eval)(t)" in p.read_text(encoding="utf-8", errors="replace"):
            pages += 1
    return {"lines": code.count("\n") + 1, "sha256": hashlib.sha256(code.encode()).hexdigest(), "pages_that_eval": pages}


def frozen():
    out = []
    for p in sorted((ROOT / "assets/components/sg-meter/v1").rglob("*")):
        if p.is_file() and "/v1.4/" not in p.as_posix():
            rel = p.relative_to(ROOT).as_posix()
            out.append({"path": rel, "lines": lines(rel), "sha256": sha(rel)})
    return out


def check_counts():
    out = {}
    for path, _ in TESTS:
        p = ROOT / path
        out[path] = len(re.findall(r"\b(?:check|pin)\(", p.read_text(encoding="utf-8"))) if p.exists() else 0
    return out


def ci_runs_tests():
    wf = (ROOT / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8")
    return [t for t, _ in TESTS if Path(t).name in wf]


def build_map():
    sync = json.loads((ROOT / "admin/build/newsroom-sync.json").read_text(encoding="utf-8"))
    files = [{"path": p, "what": w, "from": f, "lines": lines(p), "bytes": (ROOT / p).stat().st_size, "sha256": sha(p), **scan(p)}
             for p, w, f in FILES if (ROOT / p).exists()]
    pages = [{"path": p, "what": w, "lines": lines(p), "sha256": sha(p)} for p, w in PAGES if (ROOT / p).exists()]
    build = [{"path": p, "what": w, "lines": lines(p)} for p, w in BUILD]
    counts = check_counts()
    tests = [{"path": p, "what": w, "lines": lines(p), "checks": counts[p]} for p, w in TESTS if (ROOT / p).exists()]
    fr = frozen()
    code_lines = sum(f["lines"] for f in files if f["path"].endswith((".js", ".css", ".tpl")))
    labs = [{"path": p, "what": w, "lines": lines(p), "sha256": sha(p)} for p, w in LABS if (ROOT / p).exists()]
    return {
        "labs": labs,
        "what": "The map of everything a reader does on newsroom.sgit.ai, and the review of it: phase 0 of the move described in "
                f"https://{HOST}/articles/explorer-to-villager-newsroom.html. Written by admin/build/api_map.py on every build. "
                "The hashes are the 'before' for the move's rule that the live site serves the same bytes after it: scripts, "
                "styles and JSON raw; pages with the site chrome and version stamps normalised.",
        "api_means": "client-side: components, formats and contracts the browser runs, with no server and nothing to deploy but files",
        "release": VERSION, "date": DATE,
        "source": {"sgit_ai": sync["source"]["version"], "commit": sync["source"]["commit"][:7], "meter_here": "1.4.0", "meter_on_sgit_ai": "1.3.1"},
        "counts": {"reader_code_lines": code_lines, "reader_files": len(files), "pages": len(pages), "views": 12,
                   "controls": sum(len(c) for _, _, c in CONTROLS), "inputs": len(INPUTS), "outputs": len(OUTPUTS),
                   "contracts": len(CONTRACTS), "findings": len(FINDINGS), "tests": tests and sum(t["checks"] for t in tests),
                   "frozen_files": len(fr), "frozen_lines": sum(f["lines"] for f in fr), "pages_with_csp": 0},
        "files": files, "pages": pages, "build": build, "tests": tests, "ci_runs": ci_runs_tests(),
        "loader": loader(), "frozen": fr, "views_on_pages": {v: len(p) for v, p in views_on_pages().items()},
        "controls": [{"view": v, "where": w, "controls": [{"kind": k, "label": l, "does": d} for k, l, d in c]} for v, w, c in CONTROLS],
        "inputs": [{"input": a, "what": b, "who": c, "where": d} for a, b, c, d in INPUTS],
        "state": [{"field": a, "holds": b} for a, b in STATE],
        "outputs": [{"channel": a, "what": b, "when": c, "who_sees": d} for a, b, c, d in OUTPUTS],
        "contracts": [{"contract": a, "shape": b, "owner": c} for a, b, c in CONTRACTS],
        "findings": [{"id": i, "severity": s, "area": a, "finding": f, "evidence": e, "pinned_by": p, "proposed": x} for i, s, a, f, e, p, x in FINDINGS],
        "accepted": [{"gap": a, "why": b, "where": c} for a, b, c in ACCEPTED],
    }


# ----------------------------------------------------------------------------------------------- the page
def table(head, rows, cls=""):
    th = "".join(f"<th>{h}</th>" for h in head)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="tablewrap{(" " + cls) if cls else ""}"><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'


def code(s):
    return f"<code>{esc(str(s))}</code>"


def page_html(m):
    c = m["counts"]
    summary = table(["", ""], [
        ("Reader code that runs in a browser", f'{c["reader_code_lines"]:,} lines in {sum(1 for f in m["files"] if f["path"].endswith((".js", ".css", ".tpl")))} files; {c["frozen_lines"]:,} more lines in {c["frozen_files"]} frozen files of earlier meter versions, served and never changed'),
        ("Pages that carry it", f'{c["pages"]} pages written for it; the balance chip and a charged-page element on every page of the site'),
        ("Views, controls, inputs", f'{c["views"]} views of one element, {c["controls"]} kinds of control, {c["inputs"]} ways data comes in, {c["outputs"]} ways it goes out'),
        ("Contracts", f'{c["contracts"]}, listed below; the two that other sites and agents already program against are the reading-list link and articles/ids.json'),
        ("Tests", f'{c["tests"]} check calls in three files (loops make more checks at run time), now run in CI before a tag (R11)'),
        ("Pages with a Content-Security-Policy", "0 (R10)"),
        ("Upstreams", f'two: sgit.ai {m["source"]["sgit_ai"]} for the account pages, subscribe, the contact file and the meter to 1.3.1, rewritten on import to this site\'s 1.4.0 (R12)'),
    ])
    files = table(["File", "What it is", "From", "Lines", "Reaches", "SHA-256 (normalised for pages)"], [
        (code(f["path"]), esc(f["what"]), esc(f["from"]), f'{f["lines"]:,}',
         esc(", ".join(filter(None, [("hosts: " + ", ".join(f["hosts"])) if f["hosts"] else "", f'{f["fetch"]} fetch' if f["fetch"] else "",
                                       ", ".join(f["storage"]), ", ".join(f["events"]), "eval" if f["eval"] else "", "innerHTML" if f["innerHTML"] else "",
                                       "confirm()" if f["confirm"] else "", "WebCrypto" if f["crypto"] else ""]))) or "—",
         code(f["sha256"][:16])) for f in m["files"]])
    pages = table(["Page", "What", "Lines", "SHA-256, chrome and stamps normalised"], [(code(p["path"]), esc(p["what"]), p["lines"], code(p["sha256"][:16])) for p in m["pages"]])
    build = table(["Build and gate", "What it does", "Lines"], [(code(b["path"]), esc(b["what"]), b["lines"]) for b in m["build"]])
    tests = table(["Test file", "What it drives", "Check calls", "Lines", "In CI"], [(code(t["path"]), esc(t["what"]), t["checks"], t["lines"], "yes" if t["path"] in m["ci_runs"] else "no") for t in m["tests"]])
    loader = m["loader"]
    controls = "".join(
        f'<h3>{esc(v)} <span class="dim">· {esc(w)}</span></h3>' + table(["Control", "Label", "What it does"], [(esc(k), esc(l), esc(d)) for k, l, d in cs])
        for v, w, cs in CONTROLS)
    inputs = table(["Where data comes in", "What", "Who controls it, and how it is checked", "In the code"], [(esc(a), code(b) if b.startswith("<") else esc(b), esc(c), code(d)) for a, b, c, d in INPUTS])
    state = table(["Field in sgit.meter.v1", "Holds"], [(code(a), esc(b)) for a, b in STATE])
    outputs = table(["What leaves the browser", "Carrying", "When", "Who sees it"], [(esc(a), esc(b), esc(c), esc(d)) for a, b, c, d in OUTPUTS])
    contracts = table(["Contract", "Shape", "Owner"], [(f"<b>{esc(a)}</b>", esc(b), esc(c)) for a, b, c in CONTRACTS])
    findings = table(["#", "Severity", "Area", "Finding", "Evidence", "Pinned by", "Proposed change"],
                     [(f"<b>{i}</b>", esc(s), esc(a), esc(f), code(e), esc(p), esc(x)) for i, s, a, f, e, p, x in FINDINGS])
    accepted = table(["Accepted gap", "Why", "Where it is said"], [(esc(a), esc(b), esc(c)) for a, b, c in ACCEPTED])
    views = ", ".join(f"{code(v)} on {n}" for v, n in m["views_on_pages"].items())
    n_code = sum(1 for f in m["files"] if f["path"].endswith((".js", ".css", ".tpl")))
    n_verbatim = sum(1 for f in m["files"] if f["path"].endswith((".js", ".css", ".tpl")) and f["from"] == "sgit.ai, verbatim")
    body = f"""<p>&ldquo;API&rdquo; here means what the brief means by it: <b>client-side</b>. Components, formats and contracts the browser runs, with no server of ours and nothing to deploy but files. It is what other sites and agents program against: the meter&rsquo;s configuration, the reading-list link, the article numbers, the persona links, the share&rsquo;s envelope. This page maps all of it as it is at {esc(VERSION)}, before anything moves, and reviews it. It is regenerated on every build from the tree, and from the tables kept beside the code in <code>admin/build/api_map.py</code>; the same map is <a href="map.json">map.json</a>, and the review is also a <a href="../admin/notes/2026-10-11__newsroom-api-map-and-review.md">note</a>.</p>
<div class="note"><b>What the hashes are for.</b> The brief&rsquo;s rule for the move is that the live site serves the same bytes after it as before, proved by hash and not by reading the diff. The hashes below are that &ldquo;before&rdquo;: scripts, styles and JSON raw; pages with the site chrome and version stamps normalised, as the gate already does for imported pages. They change when the files change, and they are meant to.</div>
<h2 id="summary">In numbers</h2>
{summary}
<h2 id="files">The files</h2>
<p>The code a reader runs, where it comes from, and what each file reaches for. {n_verbatim} of the {n_code} code files come from sgit.ai byte for byte and cannot be changed here by a rule of the import; that is R4 and R12 below.</p>
{files}
<p class="small dim">The page loader: an inline script on every imported page ({loader["lines"]} lines, SHA-256 {code(loader["sha256"][:16])}) that loads the stylesheet and <code>assets/site.js</code>, by the vault bridge when the page is inside a vault and otherwise by fetching the text and evaluating it. {loader["pages_that_eval"]} pages carry a script that evaluates fetched text (R10). The {c["frozen_files"]} files of earlier meter versions (1.0.0 to 1.3.1, {c["frozen_lines"]:,} lines) are published artefacts on immutable paths; they move frozen, and their only test is that they are still served byte for byte.</p>
<h3>Labs, beside the reader code and not part of it</h3>
<p>Code that runs in a browser on this site, is not on a reader&rsquo;s path, and will move with the rest: today, the passkey lab. It makes no change to the reading account and is counted apart.</p>
{table(["File", "What it is", "Lines", "SHA-256"], [(code(l["path"]), esc(l["what"]), l["lines"], code(l["sha256"][:16])) for l in m["labs"]])}
<h2 id="pages">The pages</h2>
{pages}
<p class="small dim">Which pages carry which view: {views}. The balance chip is in the nav of every page; every page is a charged or free page.</p>
<h2 id="controls">Capabilities and web controls</h2>
<p>Everything a reader can click, type or pay, by view, with the call it makes. Where a control changes money or a persona, the call is named so a test can target it.</p>
{controls}
<h2 id="inputs">Inputs</h2>
{inputs}
<h2 id="state">Where the reader&rsquo;s data is kept</h2>
<p>One key in this origin&rsquo;s local storage, <code>sgit.meter.v1</code>, holds all of it; a session key holds the charge per path so a reload does not charge twice. Keys for the share and the subscription exist only in memory while the page encrypts. There is no cookie and no server-side store.</p>
{state}
<h2 id="outputs">What leaves the browser, and external calls</h2>
<p>No page loads a script from another origin. These are the ways anything leaves, each tied to something the reader does, except the first.</p>
{outputs}
<h2 id="contracts">The contracts</h2>
{contracts}
<h2 id="build">The build, the gate and the tests</h2>
{build}
{tests}
<h2 id="review">The review</h2>
<p>Read line by line on {DATE}, as villager code is read: the meter element and core, the component base, the subscribe script, the reading-list code, the loader, the build scripts and the gate. Each finding has its evidence and, where it is a bug, a test in <code>admin/build/test_review.mjs</code> that passes while the behaviour stays as it is, so that the fix is a visible change to the test. Severity is for a reader&rsquo;s money or data first, the move second. Nothing here was changed in the code, by the brief&rsquo;s rule: no behaviour changes until phase five. The one exception is R11, which is the pipeline and not the product.</p>
{findings}
<h3>Accepted, and said so</h3>
{accepted}
<h2 id="move">What the move takes from here</h2>
<ul>
<li><b>The before-hashes</b> in the file and page tables, to be compared with the live site after the move with the same normalisation.</li>
<li><b>The controls and inputs tables</b> as the checklist for the browser tests in three engines, and for the adversarial exercise: change what a reader sees or pays without a test failing.</li>
<li><b>The contracts table</b> as the README of the new repository: these are the things that must not change in a pure refactoring.</li>
<li><b>The findings</b>, one issue each, labelled with the phase they belong to; R10 and R12 are the shape of the work, the rest are its first items.</li>
</ul>
"""
    agent = (f"This page maps the client-side API of {HOST} at {VERSION}: every reader file with its hash, every view and control, every input, "
             f"what leaves the browser, the contracts, and a review with {len(FINDINGS)} findings. The same data is at https://{HOST}/newsroom-api/map.json. "
             "It is regenerated by admin/build/api_map.py on each build; the findings are pinned by admin/build/test_review.mjs. "
             "The brief it answers is https://" + HOST + "/articles/explorer-to-villager-newsroom.html.")
    return newsroom_page("newsroom-api/index.html", "The reader API: a map, and a review",
                         f"Everything a reader does on {HOST}, mapped before it moves to a repository of its own: files and hashes, views and controls, inputs, what leaves the browser, the contracts, and a line-by-line review with its findings.",
                         body, eyebrow="Phase 0 of the move: map", crumbs=(("Replicate", "replicate/index.html"),),
                         lead="Everything a reader does on this site, before it moves: the files and their hashes, what a reader can click, type or pay, where their data goes, the contracts other sites and agents program against, and what a line-by-line review found.",
                         agent=agent, wide=True)


def note_md(m):
    c = m["counts"]
    rows = "\n".join(f"| {i} | {s} | {a} | {f} | `{e}` | {p} | {x} |" for i, s, a, f, e, p, x in FINDINGS)
    acc = "\n".join(f"| {a} | {b} | {c_} |" for a, b, c_ in ACCEPTED)
    return f"""# The newsroom's reader API: a map, and a review

*Generated by `admin/build/api_map.py` at {VERSION}, {DATE}. The page is <https://{HOST}/newsroom-api/>, the data is
<https://{HOST}/newsroom-api/map.json>. Edit the tables in the script, not this file.*

Phase 0 of [Go slow to go fast](https://{HOST}/articles/explorer-to-villager-newsroom.html): map everything a reader does
on this site before it moves to a repository of its own, and review it line by line. "API" means client-side: components,
formats and contracts the browser runs.

## In numbers

- Reader code: {c["reader_code_lines"]:,} lines that run in a browser; {c["frozen_lines"]:,} more in {c["frozen_files"]} frozen files of earlier meter versions.
- {c["pages"]} pages written for it; {c["views"]} views; {c["controls"]} kinds of control; {c["inputs"]} inputs; {c["outputs"]} outputs; {c["contracts"]} contracts.
- Tests: {c["tests"]} check calls in three files (more at run time, from loops); CI runs them since this release.
- Pages with a CSP: 0. Upstreams: two (sgit.ai {m["source"]["sgit_ai"]} and this site).

## Findings

| # | Severity | Area | Finding | Evidence | Pinned by | Proposed change |
|---|---|---|---|---|---|---|
{rows}

## Accepted, and said so

| Gap | Why | Where |
|---|---|---|
{acc}

## What the move takes from here

The before-hashes (file and page tables on the page), the controls and inputs tables as the test checklist, the contracts
table as the new repository's README, and the findings as its first issues.
"""


def main():
    m = build_map()
    changed = []
    if write("newsroom-api/index.html", page_html(m)):
        changed.append("newsroom-api/index.html")
    j = ROOT / "newsroom-api/map.json"
    text = json.dumps(m, indent=1, ensure_ascii=False) + "\n"
    if not j.exists() or j.read_text(encoding="utf-8") != text:
        j.write_text(text, encoding="utf-8")
        changed.append("newsroom-api/map.json")
    n = ROOT / "admin/notes/2026-10-11__newsroom-api-map-and-review.md"
    md = note_md(m)
    if not n.exists() or n.read_text(encoding="utf-8") != md:
        n.write_text(md, encoding="utf-8")
        changed.append(n.relative_to(ROOT).as_posix())
    print(f"api_map: {m['counts']['reader_code_lines']:,} lines of reader code, {len(m['files'])} files, {len(FINDINGS)} findings; "
          f"{len(changed)} written {changed}")


if __name__ == "__main__":
    main()
