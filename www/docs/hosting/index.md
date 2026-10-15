# The hosting model

> How the reader code is served and consumed: a versioned prefix per release, never edited in place; the CORS header a cross-origin import needs; what stays on the page's origin (state, data, addresses); data-root; pinning, the manifest, rollback; CSP.

*api.newsroom.sgit.ai · v0.2.12 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/docs/hosting/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# The hosting model

> The code lives on one host, in one directory per release, and a release is never changed after it is published. The pages that run it live wherever the newsroom lives. Everything about a reader stays with the page.

## The address of a file

```
https://api.newsroom.sgit.ai/<release>/<path>
https://api.newsroom.sgit.ai/{{release}}/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter.js
https://api.newsroom.sgit.ai/{{release}}/manifest.json
```

`<path>` is the path the file had in the newsroom's repository, so the move was a prefix rewrite and nothing else; reshaping the paths is a later phase. The meter's own component versions nest inside the release unchanged. `manifest.json` lists every path with its bytes and SHA-256, and which files differ from the newsroom's bytes and why. [`releases.json`](../../releases.json) lists the releases.

## What a cross-origin host needs

GitHub Pages serves every file with `access-control-allow-origin: *`. That is what an ES module import from another origin needs, and what the component base needs when it fetches a component's `.tpl` and `.css` beside its `.js` through `import.meta.url`. Classic `<script src>` tags (the vendored vault library) need nothing. The live check after every deploy fails if the header is missing.

## What stays on the page's origin

- **The reader's state.** `localStorage` and `sessionStorage` belong to the page's origin, not the script's. `sgit.meter.v1` stays on the newsroom whichever host serves the meter. This is the property the move depended on, and a test records it.
- **The site's data.** The meter fetches the article feed and the contact file from `cfg.root` on the page; the reading list fetches `articles/ids.json` from where the page says. Nothing is fetched from this host but code.
- **The addresses.** The Stripe return page, `/for/#…`, `/persona/<id>/`, `/.well-known/sgit-subscribe.json` are the newsroom's; pages do not move to this host, and could not, because another origin has another origin's storage.

## `data-root`

Three files locate the site's root to link to pages and fetch data: the vault pane, search and ask. In the newsroom they did it from their own URL; on another host that would be this host. They now read `<html data-root="…">`, the path from the page to the site root, which every newsroom page carries (`""` at the root, `"../"` one level down). A page that imports them needs the attribute. The code they load (the vault library) they still find from their own URL.

## Pinning, the manifest, rollback

A consuming site writes the release into one file and generates every URL from it. The newsroom's is `admin/build/api.json`; its `admin/build/api.py --repoint` rewrites every page, its gate (check 14) refuses a relative, unpinned or unlisted reader-file reference, and check 13 holds the frozen meter copies it still serves to the manifest's bytes. A rollback is the previous release in that file and one run. [Taking a release](../../how-to/take-a-release/).

## Content-Security-Policy

No page sets one yet (finding R10). When one is added, `script-src` and `connect-src` include `https://api.newsroom.sgit.ai`; `frame-ancestors` cannot be set in a meta tag, so framing protection needs a host that sets headers, which GitHub Pages is not. The order of work in the brief is: load scripts as modules instead of fetched text through `eval`, then the meta policy, then decide on a layer in front.

## What a different host changed

Three files could not move unchanged, because they located the site root from their own URL: `assets/vault-pane/vault-pane.js`, `assets/search/search.js`, `assets/search/ask.js`. Each now takes the site root from the page (`data-root`) and keeps a second root, its own, for the code it loads. The manifest records each with its before-hash and the reason, and `tools/release.py` refuses any other difference from the newsroom's bytes. [The proof](../../review/proof/).

