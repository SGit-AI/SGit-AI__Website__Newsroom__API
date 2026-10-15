# A newsroom's reader, as an API

> The reading meter, pay-after-you-read, personas, reading lists in a link, the reader's vault: the code a newsroom's reader runs, open source, served from one host, live on newsroom.sgit.ai and taking money.

*api.newsroom.sgit.ai · v0.2.10 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# A newsroom's reader, as an API.

A reading meter that charges by how far you read. Paying after you read, with a rating that sets the price. Personas, a newsroom of your own, reading lists in a link, encrypted sharing, a vault that carries your account between devices. All of it runs in the reader's browser, with no server of ours, and all of it is open source. It is live on [newsroom.sgit.ai]({{newsroom}}/), and it is taking money.

[For publishers and editors](for-publishers/)[Quick start for developers](for-developers/)[For evaluators](for-evaluators/)

{{release}} · {{files}} files · {{reader_lines}} lines of reader code · {{tests}} checks in three browser engines · Apache 2.0

[Publishers, editors, executives
### What your readers get, what you keep, what it costs
A meter instead of a paywall, a reader's own newsroom instead of a feed, and a model where their data stays in their browser. The case, with the articles that made it and the numbers from a live site.
](for-publishers/)
[Developers
### Add the meter to a page in ten lines
Pinned, versioned files on one host; a JSON config; a custom element. The contracts your pages and agents program against, the data your site publishes, and the tests you can run against your own pages.
](for-developers/)
[Security, architecture, procurement
### Read the map, the review and the proof
Everything a reader can do, every place data leaves the browser, eighteen findings as public issues, a release manifest of hashes, and a move proved byte for byte.
](for-evaluators/)

## What is live today

{{live: [newsroom.sgit.ai]({{newsroom}}/) runs this release: {{articles}} articles behind a reading meter, with real payments through a Stripe link, personas, reading lists, the vault and the pane, search, and the Industry Wire read from a vault. It is the reference deployment and the first consumer of this API; [what runs and what is only designed]({{newsroom}}/shipped/) is kept honest on its own page.}}

[The meter
### Pay by depth, after you read
A page is charged by the deepest point reached; a rating at the foot sets the price from nothing to double. £5 of credit to start, in the reader's own browser.
]({{newsroom}}/articles/going-live-with-the-reading-meter.html)
[Personas
### A newsroom of your own
Read as a founder, a journalist, a security lead, a builder or a board member; keep and reject articles; picks follow. A link can open the newsroom as a persona.
]({{newsroom}}/persona/)
[Reading lists
### From me to you, in a link
Every article has a number; a list is a link with the numbers in it. No account, no server, nothing stored but the link.
]({{newsroom}}/for/make.html)
[The vault
### Your account, between devices
A passkey opens a door; the door holds the key to a master vault; the account travels encrypted, and the newsroom never holds a key.
]({{newsroom}}/vault/)

## How it works, in one picture

The pages on the newsroom's origin load the reader code from api.newsroom.sgit.ai; the reader's state stays on the page's origin

newsroom.sgit.ai (your site)
the pages, the articles, the data
<sg-meter view="page" kind="article">
localStorage · sgit.meter.v1 · the reader's state
articles/graphs.json · ids.json · .well-known/…
api.newsroom.sgit.ai (this host)
/{{release}}/ · pinned · never edited in place
assets/components/sg-meter/…/sg-meter.js
for/ · assets/vault-pane/ · assets/search/ · manifest.json
import()
Stripe (payment) · an encrypted vault (lane, wire)
only when the reader acts

The code is served from this host at a versioned path and never changed after it is published. The reader's state belongs to the page's origin, so it stays with the newsroom whichever host serves the script, and the newsroom never sees it. Nothing leaves the browser unless the reader pays, shares or subscribes, and each of those is a published contract. [The hosting model, in full](docs/hosting/).

## Open source, and why that is the point

The code is Apache 2.0, in [one repository]({{github}}), with its tests, its release manifests, its review findings as issues, and the brief it was built to. A publisher can pin a release today and run it on their own pages; a developer can read every line; an evaluator can check every hash against the live host. Nothing here needs permission.

The newsroom that runs it is the reference, not the product. The aim is other newsrooms adopting the same reader, so that a reading list or a persona made on one site means something on another, and so that the formats, the article number, the list link, the share, the envelope, outlive any one publisher. [How to adopt it](adopt/), and [who to talk to](about/).

## Where to go next

[
### Reference
The {{contracts}} contracts, the state, the inputs and outputs, the components, the hosting model.
](docs/)
[
### How-to guides
Add the meter. Make a reading-list link. Open the newsroom as a persona. Set up the subscribe lane. Take a release, roll one back. Run the tests.
](how-to/)
[
### The review
The map of everything a reader runs, {{findings}} findings as issues, the accepted gaps, and the map drawn as a layered graph.
](review/)
[
### The articles
Designed in public first: the case, the reader's own newsroom, and the engineering, each an article on newsroom.sgit.ai.
](articles/)
[
### Releases
Every release, its notes and its manifest. The current one is {{release}}.
](releases/)
[
### For agents
The brief for the agents that keep this repository and the newsroom: the rules, where things are, how to change them.
](agents/)
