# Versions

> Every version of this repository that landed on dev, newest first, with the reader-code release each one serves and what changed, in a line.

*api.newsroom.sgit.ai · v0.2.8 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/versions/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

- **v0.2.8** (2026-10-15, reader code v0.2.5): A link-preview card for every page (og:image 1200x630 and the Twitter card), drawn by site/og.py in Newsprint's colours and committed; the gate fails a page without one.
- **v0.2.7** (2026-10-15, reader code v0.2.5): The backfill's grep named two matchers at once and would have matched nothing; one matcher.
- **v0.2.6** (2026-10-15, reader code v0.2.5): The deploy tags every version in the history that has none (each commit's subject carries its version), so several versions landing in one push each get their tag.
- **v0.2.5** (2026-10-15, reader code v0.2.5): Reader-code release: wire/wire.css wraps a story's long words (a URL as plain text in the lead story's corrections overflowed a phone; test_wire caught it). The first change to a served file since the move, recorded in the manifest with its reason.
- **v0.2.4** (2026-10-14, reader code v0.2.0): The website's gate (site/check.py): every reference resolves, canonical and chrome on every page, the sitemap and llms files agree with the tree, a key-leak tripwire. The map and the proof data are published on the host. This versions page.
- **v0.2.3** (2026-10-14, reader code v0.2.0): test_review pins R2 as the personas page being unusable in either form (blank, or the element failed), as CI run 13 saw.
- **v0.2.2** (2026-10-14, reader code v0.2.0): The website wears the newsroom's five themes: its token file and bootstrap, unchanged; the picker in the bar; one row from 1280 up; print and reduced motion; tests/test_site.mjs as the gate.
- **v0.2.1** (2026-10-14, reader code v0.2.0): Every change that lands on dev is a version: tools/version.json holds the repository's version beside the reader-code release; the deploy tags the version and refuses a missed bump.
- **v0.2.0** (2026-10-14, reader code v0.2.0): The second cut of the reader code, from the newsroom at v0.12.50 (74 files; SG Meter v1.4.1, the inbox, the graphs, the QR library); the release the newsroom pins at its v0.13.0. The tests re-adapted, test_graphs and test_inbox added.
- **v0.1.0** (2026-10-13, reader code v0.1.0): The first cut of the reader code, from the newsroom at v0.12.10 (63 files), the pipeline, the proof of the move, and the website for publishers, developers, evaluators and agents.
