# The contracts

> The fourteen contracts other sites, pages and agents program against: the meter config, a charged page, persona links, the reading-list link, article numbers, the return page, the export, the share, the envelope, the contact file, the wire's vault, events, a component, the import's rules.

*api.newsroom.sgit.ai · v0.2.12 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/docs/contracts/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

## The contracts

| Contract | Shape | Owner |
|---|---|---|
| The meter config | storageKey, start, newDays, symbol, prices{article_new,article,issue,note,collection,page,free}, depth, minDepth, topup{amount,link}, packs, links{account,topup,how}, rating{price[5],more[5]}, autoKeep, picks{feed,base}, links2{newsroom,personas,share}, share{contact,form,site,max}, personas{presets[],names{}}, root | `sg-meter-core.js DEFAULTS; written into every page by sgit.ai's build and re-pointed by the import` |
| A charged page | <sg-meter view="page" kind="article/issue/note/collection/page/free" date="…" topics="a b" title="…" [quiet]>: the price class comes from the page | `sgit.ai's build for imported pages; page.py (kind=free, quiet) for this site's` |
| A persona link | /persona/<id>/ and /persona/#<id>, id ∈ {founder, journalist, security, builder, board} | `personas.py, persona/links.json` |
| A reading list link | /for/#from=&to=&r=&s=&f=&n=&e=: names ≤ 40 chars of letters, spaces, hyphens, apostrophes; r,s article numbers, 1–50 in all; f persona ids or c:<collection>, ≤ 10; n ≤ 240 chars; e an address | `for/reading-list.js LIMITS, parse(), build()` |
| Article numbers | articles/ids.json: n and slug are the contract, assigned once in publication order, never changed or reused; every other field is display text | `admin/build/ids.py; validate.js check 12` |
| The return page | ?session_id=<ref>: credited once per distinct value, never verified | `_toppedUp(), credit()` |
| The export | the state as JSON; restore accepts any file with balance:number and log:array | `restore()` |
| The share | a text summary then the same data as JSON {v:1, site, at, balance, spent, declined, reads, topups, active, personas, topics, cols, log}, as an .eml with X-SGit-Form, X-SGit-Reply-To, X-SGit-Name, X-SGit-Subscribe, X-SGit-Page | `shareData(), _send()` |
| The envelope | sgit hybrid envelope v2: {v:2, w, i, c} (RSA-OAEP-SHA256 wrapped AES-256-GCM key, iv, ciphertext), base64, then base64 again as the lane payload | `envelope(), subscribe.js encrypt()` |
| The contact file | sgit-subscribe/v1: recipient{address, fingerprint, encrypt}, inbox{vault, endpoint, encrypt_to, status, lane{name, append_token}}; the fingerprint is recomputed from the PEM before use | `.well-known/sgit-subscribe.json` |
| The wires' vaults | u9i9jp0l (the Industry Wire), eitf274v (OWASP), v202bla5 (AWS), p6twygul (Portugal) on dev.send.sgraph.ai, read keys published; data/bundle.json {beats, stories, sources, personas, brief; wire, map, stack when present}, data/deliveries.json, data/releases.json (wire-releases/v1, one entry per publish), docs/*.md; story fields, changes and status shown as written; everything in a vault is public, for ever | `admin/build/wire-vault*.json; wire/how.html; each wire's agents own its content` |
| Events | sg:meter.changed · charged · rated · declined · toppedup · reset · restored · persona · shared; sg-meter:error | `sg-meter-core.js _emit(), sg-component.js failed()` |
| A component | static jsUrl, get resourceName(), onReady(); a .tpl and a .css beside the .js; published at an immutable versioned path | `sg-component.js` |
| The import's rules | the meter path rewrite (v1.3.1 → v1.4.1), the top-up link, ten text rules, the article number line, the moved banner cut, the foot of every issue; each stops the import when its anchor moves | `sync_newsroom.py items 9–15` |
