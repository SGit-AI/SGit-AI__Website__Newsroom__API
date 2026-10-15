# Adopt it

> Three ways in: put the meter on your own pages today; run a newsroom like newsroom.sgit.ai; pilot it with the people who built it. What you need, what you keep, what you give, and why the formats matter more than any one site.

*api.newsroom.sgit.ai · v0.2.14 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/adopt/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Adopt it

> Nothing here needs permission. The code is Apache 2.0, the releases are directories of files with a manifest of hashes, and the live site that runs it is the reference, not the product. The aim is other newsrooms running the same reader, so that the formats, the article number, the list link, the share, the envelope, mean the same thing everywhere.

## Three ways in

**1. Put the meter on your pages.** A static site, a JSON config, a custom element, a pinned import from this host. Readers get a credit and a balance, pay by depth and after reading, and rate. Your site publishes two small data files. [Ten lines, explained](../how-to/add-the-meter/). This is the route for a section of an existing site.

**2. Run a newsroom like this one.** The newsroom's repository is public: the pages, the build, the sync, the gate, the engineering board. Fork it, point it at this host, change the words. The newsroom's own [replicate](https://newsroom.sgit.ai/replicate/) page says what is packaged and what is not yet (the article generator; payments beyond a Payment Link).

**3. Pilot it with us.** For a publisher who wants to try the whole thing, meter, personas, lists, the vault, on a part of their site with their own payment link and lane, and to learn with us from what readers do. Write to [agent@riskmandate.ai](mailto:agent@riskmandate.ai) (an agent reads first; a person answers) or [open an issue]({{github}}/issues).

## What you need

- A static host for your pages (any; the newsroom uses GitHub Pages).
- The article feed (`articles/graphs.json`) and the numbers file (`articles/ids.json`), written by your build. [The contracts](../docs/contracts/).
- A Stripe Payment Link for the top-up, returning to your account page. Until it is set the site says so and nothing is charged.
- Optionally a vault on an SG/Send host for the lane: shares, subscriptions and notes arrive there, encrypted to your key. [Setting up the lane](../how-to/subscribe-lane/).
- One line that pins the release you load, and a copy of its manifest. [Taking a release](../how-to/take-a-release/).

## What you keep, what you give

You keep your readers' trust in a concrete form: their data never reaches you unless they send it, and when they do it arrives encrypted to a key only you hold. You keep the money, through your own payment link. You keep the site you have.

You give nothing to us. There is no account, no key, no telemetry, no call home: the only requests to this host are for the code, and a release never changes. If you prefer, copy a release to your own host; the manifest tells you whether you have the same bytes.

## Why the formats matter more than the site

An article number that never changes. A reading list that is a link. A persona that is a name, a theme and a list of what was kept. A share that is an encrypted envelope to a published key. These are the parts that are worth agreeing on across newsrooms, because then a reader's habits are theirs and not a site's. The [contracts](../docs/contracts/) are small on purpose, and changing one is a release with a note, never an edit in place.

## Contributing

- Issues are the work: every finding of the review is one, and every change starts as one.
- A pull request is reviewed by a person and an agent before it merges; the agent's review is a required check.
- The served files are frozen until phase 4 of [the brief](https://newsroom.sgit.ai/articles/explorer-to-villager-newsroom.html) is finished: a change is a new release with a test that fails without it and a reason in the pull request.
- The tests run in three engines on every commit, against the newsroom's real pages; a change that breaks a page there is caught before it ships.

The brief that governs the work, and what changed when the move was done: [`briefs/`]({{github}}/tree/dev/briefs) in the repository. The way the agents that keep this work are briefed is [the agents page](../agents/), which is written for people too.

