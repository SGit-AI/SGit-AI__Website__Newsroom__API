# Add the meter to a page

> Put the reading meter on your site: the element at the foot of each page, the balance chip in the nav, the JSON config written once by your build, the pinned import, the account pages, and the article feed the picks read.

*api.newsroom.sgit.ai · v0.2.4 (reader code v0.2.0) · this file is generated from the same source as <https://api.newsroom.sgit.ai/how-to/add-the-meter/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Add the meter to a page

> Ten lines on each page, one config written by your build, and five account pages you copy. Nothing to deploy but files.

## 1. The element, where the charge happens

At the foot of the content, after the last paragraph a reader would reach:

```html
<sg-meter view="page" kind="article" date="2026-10-11" topics="newsroom sg-meter"
          title="Going live with the reading meter"></sg-meter>
```

`kind` is the price class (`article`, `issue`, `note`, `collection`, `page`, `free`); an article newer than `newDays` is charged as `article_new`. `date` and `topics` feed the personas' picks; `title` is what the history shows. A page that should charge nothing is `kind="free" quiet`, which keeps the balance on screen without a card (a synthetic reader once took a vanished chip for lost credit).

## 2. The chip, in the navigation

```html
<sg-meter class="meter-nav" view="balance"></sg-meter>
```

On every page, so a reader never loses sight of their balance. It marks a negative balance and opens the account.

## 3. The config, once

A JSON block with id `sg-meter-config`, the same on every page; write it in your build so it cannot drift. Prices in pence; every key has a default. The full shape and a live example are on [the developer quick start](../../for-developers/). The parts you will change:

```json
{"start": 500, "newDays": 7, "symbol": "£",
 "prices": {"article_new": 10, "article": 5, "issue": 3, "note": 2, "collection": 2, "page": 1, "free": 0},
 "topup": {"amount": 500, "link": ""},
 "links": {"account": "account/index.html", "topup": "account/top-up.html", "how": "about/the-meter.html"},
 "picks": {"feed": "articles/graphs.json", "base": "articles/"},
 "share": {"contact": ".well-known/sgit-subscribe.json", "form": "reading-share", "site": "your-site.example", "max": 300}}
```

Leave `topup.link` empty until your Stripe Payment Link exists: the top-up page then says that no money moves. The newsroom's gate refuses a test-mode link on a live page.

## 4. The import

```html
<script>
import('https://api.newsroom.sgit.ai/{{release}}/assets/components/sg-meter/v1/v1.4/v1.4.0/sg-meter.js')
 .catch(function (e) { console.error('[sg-meter] component failed to load:', e); });
</script>
```

Pinned to a release and a component version; neither is ever edited in place. Generate the URL from one place in your build ([taking a release](../take-a-release/)).

## 5. The account pages

Five pages your site serves, each a shell around one view: `account/index.html` (`view="account"`), `account/top-up.html` (`topup`), `account/topped-up.html` (`topped-up`; set it as the Stripe link's return URL with `?session_id={CHECKOUT_SESSION_ID}`), `account/newsroom.html` (`newsroom`), `account/personas.html` (`personas`), and `account/share.html` (`share`). Copy the newsroom's: [account/](https://newsroom.sgit.ai/account/). The paths go in `links` and `links2` of the config.

## 6. The feed

`articles/graphs.json` with one entry per article (`slug`, `title`, `date`, `url`, `teaser`, `topics`, `tags`) is what the picks and the persona graph read. The newsroom's build writes it from the articles; yours can write it from whatever you have. Without it the meter still charges; the newsroom view says the list could not be loaded.

## 7. Check it

Open a page: the chip shows £5.00; scroll to the foot and watch the balance fall; rate the page at the card and see the price move; reload in the same tab and see nothing charged twice. Then run `tests/test_meter.mjs` against your site ([running the tests](../run-the-tests/)).

## What to read before going live

[Going live with the reading meter](https://newsroom.sgit.ai/articles/going-live-with-the-reading-meter.html) for what was switched on and in what order, [Who will game the reading meter](https://newsroom.sgit.ai/articles/who-will-game-the-reading-meter.html) for the threat model, and [the security model](https://newsroom.sgit.ai/meter/security.html) for the gaps the design accepts.

