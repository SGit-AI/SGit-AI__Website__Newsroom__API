# For publishers, editors and executives

> What a reader gets, what the newsroom keeps, what it costs to adopt, what is live and taking money, and what is honestly not there yet. The case for a reading meter and a reader's own newsroom, from a site that runs one.

*api.newsroom.sgit.ai · v0.2.15 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/for-publishers/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# For publishers, editors and executives

You know the problem. A paywall turns a reader away at the door; a free site pays nothing back; a subscription asks for a commitment before the first paragraph. This is a third thing, running on a live site since October 2026: a reader walks in with a small credit, a meter charges by how far they read, they pay after, and what they pay is set by what they thought of it. Around it, a newsroom that is theirs: personas, picks, lists they can send in a link, an account that travels with them, and none of it on a server of ours.

{{live: Everything on this page is running at [newsroom.sgit.ai]({{newsroom}}/). Open any article and watch the balance in the top bar; [the reading account]({{newsroom}}/account/) shows what you spent and why. It is a working instance, not a demo.}}

## What a reader gets

[Pay after you read
### A meter, not a wall
£5 of credit to begin. An article costs 5p, a new one 10p, charged by the deepest point reached. Rate it at the foot and the price moves: excellent is double, not useful is free. Declining refunds the page.
]({{newsroom}}/articles/pay-after-you-read.html)
[Personas
### Read as who you are today
A founder, a journalist, a security lead, a builder, a board member. Each has a starting reading list and picks that follow what they keep and reject. A link can open the site as one.
]({{newsroom}}/articles/a-link-to-a-persona.html)
[Reading lists
### Send five articles, not five links
Every article has a number that never changes. A reading list is a link with the numbers in it, from you to a named reader, with a note. Nothing is stored anywhere but the link.
]({{newsroom}}/articles/a-reading-list-in-a-link.html)
[The vault
### An account that travels, with no sign-in
A passkey opens an encrypted vault that carries the reading account between a phone and a laptop. The newsroom never holds a key and cannot read it.
]({{newsroom}}/articles/the-vault-is-live.html)
[Notes
### Write back, one tap
A reader marks a page done, wrong, more like this, or writes to the newsroom; the notes travel in their vault and arrive encrypted in a lane the newsroom reads.
]({{newsroom}}/articles/the-site-is-an-inbox.html)
[The wire
### Industry news as an inbox
Stories agents gather into a vault, read live in the browser, filtered by the reader's lens, with what is new since their last visit.
]({{newsroom}}/wire/)

## What the newsroom keeps, and what it never holds

### Keeps

- The money. A reader tops up through a Stripe Payment Link you own; the return page credits their balance. No card data touches your site.

- The formats. Article numbers, persona links, the reading-list grammar, the share envelope: published contracts your readers and their agents can rely on, and that other newsrooms can share.

- The relationship. Shares and subscriptions arrive encrypted to a key only you hold, in a write-only lane; notes from the pane arrive the same way, with the page and the reader's words.

- The site you have. Static pages, any host. The reader code is a handful of files pinned from this host.

### Never holds

- Reader data. The balance, the history, the personas, the lists and the notes live in the reader's browser, and in their own vault if they choose one. There is no reader database because there is no server.

- Keys. The vault's keys are derived from the reader's passkey; the newsroom reads a lane with a read key the reader hands over, and nothing else.

- A dependency on us. The code is Apache 2.0, every release is a directory of files with a manifest of hashes, and a rollback is one line.

## What it costs to adopt

- 
### A static site
Your pages, wherever they are hosted. The meter is a custom element and a JSON config on each page; the balance chip sits in your navigation. [Ten lines](../how-to/add-the-meter/).

- 
### Two small data files
An article feed (titles, dates, topics, teasers) for the picks, and a numbers file that gives every article a stable number. The newsroom's build writes both; yours can too. [The contracts](../docs/contracts/).

- 
### A payment link
A Stripe Payment Link for the top-up, returning to your account page. Until it is set, the site says so and no money moves.

- 
### A vault for the lane, optional
Shares, subscriptions and notes arrive in an encrypted vault on an SG/Send host, drained by a person or an agent with your key. Without it, the meter still runs; the reader just cannot write back.

- 
### A pinned release
One line names the release you load from this host; a manifest lists every file's hash; a rollback is the previous line. [How](../how-to/take-a-release/).

## The numbers from a live site

credit to start£5.00in the reader's browser, no sign-in

an article5p10p when new; by depth; nothing if not useful

top-up£5by card, through a Stripe Payment Link

starting personas5each a reading list and a link

reader code{{reader_lines}} linesopen source, reviewed, tested in three engines

servers of ours0by design; the security model says what that accepts

## What is honestly not there yet

The site that runs this says so on its own [what runs, what is designed]({{newsroom}}/shipped/) page, and the review here lists it as [findings](../review/). In short: the balance lives in the reader's browser, so a reader can edit their own credit, and the return page credits a payment reference without verifying it; both are accepted and written down in [the security model]({{newsroom}}/meter/security.html). No page sets a Content-Security-Policy yet. The vault hosts the live site uses are named dev. Shares from the newsroom are still labelled with the site the code came from. Each is an open issue with a proposed change, and each will be a visible change to a test when it is fixed.

## The thinking behind it

None of this was built first and explained after. Each piece is an article on newsroom.sgit.ai, written before it shipped and again when it went live. For an editor or an executive, start with these four:

[The case
### The future of news is a story vault, not a paywall
Why the unit of news should be a story a reader can hold, not a wall they must cross.
]({{newsroom}}/articles/future-of-news-story-vault-not-paywall.html)
[The thesis
### Sell the graph
The newsroom's founding idea: the value is in the connections between what is published, and that is what a reader pays for.
]({{newsroom}}/thesis/)
[Economics
### Paying the fact creator
What a meter makes possible that a subscription does not: money that follows the reading, down to the person who found the fact.
]({{newsroom}}/economics/)
[Going live
### Going live with the reading meter
The day real money started moving, what was switched on, and the line between what runs and what is designed.
]({{newsroom}}/articles/going-live-with-the-reading-meter.html)

More: [the articles behind it](../articles/), in reading order. The design pages on [corrections that propagate, provenance as the product, and content rights]({{newsroom}}/design/) are the newsroom's own.

## Starting a pilot

If you run a newsroom and want to try this on a section of your site, with your own payment link and your own lane, the people behind newsroom.sgit.ai will help you set it up and will learn from what your readers do. Write to [agent@riskmandate.ai](mailto:agent@riskmandate.ai), which an agent reads first and a person answers, or open [an issue]({{github}}/issues) in the repository, which is where the work happens in any case. Share this page with your team: the [developer quick start](../for-developers/) is what they will ask for next, and [the evaluator's page](../for-evaluators/) is what your security team will.
