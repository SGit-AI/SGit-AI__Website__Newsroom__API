# For developers

> Add the reading meter to a page with a pinned, versioned import and a JSON config; the custom element's views; the data your site publishes; the hosting model and CORS; the tests you can run against your own pages.

*api.newsroom.sgit.ai · v0.2.7 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/for-developers/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# For developers

A client-side API: components, formats and contracts the browser runs, with no server and nothing to deploy but files. Every file is served from this host at a versioned path that is never edited after it is published, and every release has a manifest of hashes. You pin a release; a rollback is one line.

## 1. Put the meter on a page

Three pieces in the page: the element where the charge happens, the config, and the import. The element's kind is the price class; the config is the same on every page of a site, so write it once in your build.

<!-- the balance chip, in your nav -->
<sg-meter class="meter-nav" view="balance"></sg-meter>

<!-- at the foot of the content: the page's charge and the reader card -->
<sg-meter view="page" kind="article" date="2026-10-11" topics="newsroom sg-meter" title="Going live with the reading meter"></sg-meter>

<script type="application/json" id="sg-meter-config">
{"storageKey": "sgit.meter.v1", "start": 500, "newDays": 7, "symbol": "£",
 "prices": {"article_new": 10, "article": 5, "issue": 3, "note": 2, "collection": 2, "page": 1, "free": 0},
 "depth": true, "minDepth": 0.1,
 "topup": {"amount": 500, "link": "https://buy.stripe.com/YOUR_PAYMENT_LINK"},
 "packs": [{"id": "p5", "price": 500, "bonus": 0}, {"id": "p10", "price": 1000, "bonus": 100}],
 "links": {"account": "account/index.html", "topup": "account/top-up.html", "how": "articles/how-the-meter-works.html"},
 "links2": {"newsroom": "account/newsroom.html", "personas": "account/personas.html", "share": "account/share.html"},
 "rating": {"price": [0, 0.5, 1, 1.5, 2], "more": [-3, -1, 0, 3, 6]},
 "autoKeep": true,
 "picks": {"feed": "articles/graphs.json", "base": "articles/"},
 "share": {"contact": ".well-known/sgit-subscribe.json", "form": "reading-share", "site": "your-site.example", "max": 300},
 "personas": {"presets": []}}
</script>
<script>
import('https://api.newsroom.sgit.ai/{{release}}/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter.js')
 .catch(function (e) { console.error('[sg-meter] component failed to load:', e); });
</script>
Prices are in pence (or the smallest unit of symbol). start is the opening credit. The paths in links, picks and share.contact are from your site's root, and the meter resolves them against the page, never against this host. Every key has a default, so a config can be short; the full shape is [the meter config contract](../docs/contracts/).

Only sg-meter.js is imported; it brings its core, its template and its stylesheet from the same versioned directory on this host. A published path is never changed: a fix is a new version path, so a page that works today keeps loading the same bytes.

## 2. The element's views

One element, twelve views, each a page or a part of one. view="page" charges and shows the reader card; the rest are the account.

ViewWhere it goesWhat it does

balancethe navigation, on every pagethe balance chip; marks a negative balance; opens the account

pagethe foot of any content pagecharges by depth for the page's kind; the reader card: rating, decline, keep for a persona. quiet for a free page

accountyour account/index.htmlbalance, spent, history, top up, export and restore

topup, topped-upthe top-up page; the page the payment returns tothe packs and the payment link; crediting the return once per reference

newsroomthe reader's newsroom pagepicks for the active persona from your feed; the persona graph

personasthe personas pagethe presets, the reader's own, rename, activate, keep and reject

landinga persona page (/persona/<id>/)a link opens the site as a persona, added as a visitor the reader can keep or remove

sharethe share pagea summary and the data as JSON, encrypted to your key and sent to your lane, after consent

The newsroom's own account pages are the reference implementation: [account]({{newsroom}}/account/), [newsroom]({{newsroom}}/account/newsroom.html), [personas]({{newsroom}}/account/personas.html), [share]({{newsroom}}/account/share.html), [top-up]({{newsroom}}/account/top-up.html). Copy their bodies; the element does the work.

## 3. The data your site publishes

FileForShape

articles/graphs.jsonpicks, the persona graph, the reading list's titles{"articles": [{"slug", "title", "date", "url", "teaser", "topics": [], "tags": []}, …]}; the newsroom's is [here]({{newsroom}}/articles/graphs.json)

articles/ids.jsonreading lists in a link{"next": N, "articles": [{"n", "slug", "title", "date", "url", …}]}: n and slug are the contract, assigned once, never changed or reused

.well-known/sgit-subscribe.jsonthe share and subscribe lanesgit-subscribe/v1: your public key and its fingerprint, the lane's vault, endpoint and append token. [Setting one up](../how-to/subscribe-lane/)

persona/links.jsonwhoever writes the persona linksone entry per preset, with its page; generated from the config

## 4. The reader's own newsroom: lists, personas, the vault, search

These are pages of your own that import the code from this host. Each needs <html data-root="../"> (the path from the page to your site's root), which is how the pane and search find your pages and data from another origin.

<!-- a reading list page at /for/: opens the list in the address -->
<link rel="stylesheet" href="https://api.newsroom.sgit.ai/{{release}}/for/for.css">
<div id="rl-mount"></div>
<script type="module">
import { openList } from 'https://api.newsroom.sgit.ai/{{release}}/for/reading-list.js';
openList({ core: 'https://api.newsroom.sgit.ai/{{release}}/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter-core.js',
           ids: '../articles/ids.json', root: '../', mount: document.getElementById('rl-mount') });
</script>

<!-- the vault pane, beside the balance chip in your nav, on every page that carries the meter -->
<button class="vault-btn" type="button">Vault</button>
<link rel="stylesheet" href="https://api.newsroom.sgit.ai/{{release}}/assets/vault-pane/vault-pane.css">
<script type="module" src="https://api.newsroom.sgit.ai/{{release}}/assets/vault-pane/vault-pane.js"></script>
The make page (for/make.js), the persona pages, the search page (assets/search/search.js, ask.js) and the wire (wire/wire.js) follow the same pattern; the newsroom's pages are the worked examples, and [the how-to guides](../how-to/) walk through each.

## 5. The hosting model, and what a different host changes

GitHub Pages serves every file here with access-control-allow-origin: *, which is what a cross-origin module import and the component's sibling fetches need. Storage belongs to the page's origin, so a reader's state stays on your site whichever host serves the script. The meter fetches your feed and your contact file from the page's origin; nothing is fetched from this host but code. If you add a Content-Security-Policy, script-src and connect-src name https://api.newsroom.sgit.ai. [The hosting model](../docs/hosting/).

## 6. Pin a release, verify it, roll it back

# the current release and its manifest
curl -s https://api.newsroom.sgit.ai/releases.json
curl -s https://api.newsroom.sgit.ai/{{release}}/manifest.json | head -40

# check one file against the manifest
curl -s https://api.newsroom.sgit.ai/{{release}}/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter.js | sha256sum
Write the release into one place in your build and generate every URL from it; the newsroom does this with admin/build/api.json and checks every page against the manifest in its gate. [Taking a release and rolling back](../how-to/take-a-release/).

## 7. Run the tests against your pages

The tests that cover the meter, the lists, the pane, search and the wire are in the repository, and they run against any site that imports this code: they serve your pages locally and route this host to the working tree, in Chromium, WebKit or Firefox.

git clone {{github}}
cd SGit-AI__Website__Newsroom__API && npm install --no-save playwright@1.56.1 && npx playwright install chromium
NEWSROOM=/path/to/your/site node tests/test_meter.mjs
BROWSER=firefox NEWSROOM=/path/to/your/site node tests/test_lists.mjs
[Running the tests](../how-to/run-the-tests/), including what each file covers and which need Chromium.

## Where everything is

- [Reference](../docs/): contracts, state, inputs and outputs, components, hosting.

- [How-to guides](../how-to/), one task each.

- [Releases](../releases/) and [the current manifest](../{{release}}/manifest.json).

- [Source]({{github}}), [issues]({{github}}/issues), and [the brief for agents](../agents/), which is also the brief for a person changing the code.

- [SG Meter, documented]({{newsroom}}/meter/) on the newsroom, with [its security model]({{newsroom}}/meter/security.html).
