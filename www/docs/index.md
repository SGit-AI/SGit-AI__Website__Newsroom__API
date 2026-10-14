# Reference

> The reference for the SGit Newsroom API: the contracts, the reader's state and every input and output, the components and what each file is, the hosting model, pinning and the manifest, the reading-list link grammar, events.

*api.newsroom.sgit.ai · v0.2.3 (reader code v0.2.0) · this file is generated from the same source as <https://api.newsroom.sgit.ai/docs/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Reference

> Everything here is read from a record: the map of what a reader runs (`map/before/<release>/map.json`), the release manifests, `tools/served.json`. A number on these pages is not typed; a contract changes only with a release.

## Pages

- [**The contracts**](contracts/): the {{contracts}} formats other sites, pages and agents program against: the meter config, a charged page, persona links, the reading-list link, article numbers, the return page, the export, the share, the envelope, the contact file, the wire's vault, events, a component, the import's rules.
- [**State, inputs and outputs**](state/): what `localStorage` holds under `sgit.meter.v1`, everything that comes in and who controls it, and every channel by which anything leaves the browser.
- [**The components**](components/): the served files by group, what each is for, how they are versioned, and which are frozen.
- [**The hosting model**](hosting/): `https://api.newsroom.sgit.ai/<release>/<path>`, never edited in place; CORS; the page's origin and `data-root`; pinning, the manifest and rollback; what a Content-Security-Policy must name.
- [**The reading-list link**](reading-list-link/): the grammar of `/for/#…`, field by field, with the limits the parser enforces.

## The element, in brief

`<sg-meter view="…">` is one custom element with twelve views; the page's charge is `view="page"` with a `kind` (`article_new` is derived from `date` and `newDays`, the rest are `article`, `issue`, `note`, `collection`, `page`, `free`), `date`, `topics`, `title`, and `quiet` for a page that charges nothing. The config is a JSON block with id `sg-meter-config`; every key has a default. The views, the attributes and a full config are on [the developer quick start](../for-developers/).

## Events

The meter emits DOM events on `document` that a page or another component can listen to: `sg:meter.changed`, `sg:meter.charged`, `sg:meter.rated`, `sg:meter.declined`, `sg:meter.toppedup`, `sg:meter.reset`, `sg:meter.restored`, `sg:meter.persona`, `sg:meter.shared`; and `sg-meter:error` when the element fails, with `why`.

## Versions

The meter's own line is `v1.4.0`, served at `assets/components/sg-meter/v1/v1.4/v1.4.0/`; `v1.0.0` to `v1.3.1` are frozen and still served, so a page that pinned one keeps working. The API's releases (`{{release}}` today) wrap all of it under a versioned prefix. [Releases](../releases/).

