# State, inputs and outputs

> Where a reader's data lives (localStorage on the page's origin), everything that comes in, and every channel by which anything leaves the browser.

*api.newsroom.sgit.ai · v0.2.2 (reader code v0.2.0) · this file is generated from the same source as <https://api.newsroom.sgit.ai/docs/state/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

## State

- `v`: 3
- `created`: ISO time
- `balance · spent · declined`: pence, to 0.1p
- `reads`: pages opened
- `paused`: always false since v1.4.0
- `log[]`: ≤ 500 entries: id, at, path, title, kind, topics, price, depth, cost, persona, autoKept?, rating{useful,more,detail,at}?, declined{reason,at,refunded}?
- `topups[]`: ref (≤ 40 chars), at, credit, source: link | simulated
- `sessions[]`: every payment reference credited, unbounded
- `cart[]`: the simulated cart (unused with a live link)
- `active`: the active persona's id
- `personas[]`: id, preset, name, created, on[], off[], visitor?, list? (a reading list's key), theme?
- `shares[]`: ≤ 20: at, how, pages

## Inputs

- **Element attributes**: view · kind · date · topics · title · quiet · count · persona · compact (the page's own markup (trusted: it is this site's build); `sg-meter.js`)
- **The page's config**: <script type="application/json" id="sg-meter-config"> (this site's build, written once per page; every key has a default; `sg-meter-core.js _config()`)
- **The address: query**: ?session_id= on account/topped-up.html (whoever made the link; any value is credited once (accepted, documented); `_toppedUp()`)
- **The address: fragment**: #<persona id> on persona/; #from,to,r,s,f,n,e on for/ and for/make.html (whoever made the link; validated field by field, the rest dropped and listed; `_named(), reading-list.js parse()`)
- **The address: path**: location.pathname (the charge is keyed on it; the slug is taken from it; the share records it; `open(), _page(), _send()`)
- **Local storage**: sgit.meter.v1 (the state), sgit.meter.v1.seen (session: the charge per path) (this browser, written by the meter; also by the reader, who may edit it (accepted); `_read(), _seen()`)
- **A file**: Restore from an export… (whoever made the file; checked for balance:number and log:array only; `restore()`)
- **Forms**: the share form, the subscribe form, the make page (the reader; email checked by a loose pattern, names by a strict one; `_send(), subscribe.js, make.js`)
- **The wires' vaults**: data/bundle.json (with wire, map or stack when the vault has them), data/deliveries.json, data/releases.json, docs/*.md, decrypted in the browser; one vault per wire (whoever holds the vault's write key (the wire's agents); drawn as text, links only from http(s) values, markdown rendered by an escaping renderer; the vault's own HTML is not used; `wire/wire.js`)
- **Own-origin data**: articles/graphs.json · articles/ids.json · .well-known/sgit-subscribe.json · sg-meter.tpl · sg-meter.css (this site's build; the contact file's key is checked against its fingerprint; `feed(), openList(), _send()`)
- **postMessage**: replies from the dev.vault.sgraph.ai frames (origin-checked; drives a status line only; `vault-ui-embed.js`)

## Outputs

- **GET, own origin**: every page, script, style, image and JSON; whenever a page opens; seen by GitHub Pages, which sees the request as any host does
- **POST https://dev.send.sgraph.ai/api/vault/append/write/y9j3nc60**: {append_token, payload}: an .eml encrypted in the browser to the lane's public key; when the reader presses Send on the share page or Subscribe; seen by the vault host; it sees ciphertext, a size and a time
- **Navigation to https://buy.stripe.com/…**: the reader leaves for Stripe's page and returns to /account/topped-up.html?session_id=…; when the reader presses Top up / Pay; seen by Stripe (card, email, name, postcode)
- **GET https://dev.send.sgraph.ai/api/vault/read/u9i9jp0l/…**: the ciphertext of the wire's vault: its head pointer, commit, tree and the files the page needs, decrypted in the browser with the published read key; when a wire page opens, and when the reader asks for a new commit; the pointer at most every two minutes; seen by the vault server; it sees the request and nothing of the reader
- **iframe https://dev.vault.sgraph.ai/?embed=1**: two frames; the published read key is posted to them; on the study page only; seen by the vault UI host
- **mailto:**: Reply to <sender> on a reading list; the subscribe fallback; when pressed; the page sends nothing; seen by the reader's mail client
- **A download**: reading-account.json: the whole state, payment references included; Export as JSON; seen by the reader's disk
- **The clipboard**: a link, or the share text; Copy; seen by the reader's clipboard
- **postMessage to the parent window**: {type:'sg-app-ready'} with targetOrigin *; when a page is framed; seen by whoever framed it
