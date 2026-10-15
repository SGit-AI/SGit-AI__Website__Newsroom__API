# The reading-list link

> The grammar of a reading list in a link, field by field, with the limits the parser enforces, how a list opens as a visitor persona, and what is deliberately not in it.

*api.newsroom.sgit.ai · v0.2.12 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/docs/reading-list-link/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# The reading-list link

> A reading list is a link. Everything the recipient sees is in the part after the `#`, which never reaches a server; nothing is stored anywhere but the link itself.

```
https://newsroom.sgit.ai/for/#from=Dinis&to=Steve&r=65,60,62&s=66&f=founder&n=Start%20with%2065
```

| Field | What it is | Rules |
|---|---|---|
| `from` | who made the list | up to 40 characters of letters, spaces, hyphens and apostrophes; anything else is dropped and listed under *Left out* |
| `to` | who it is for | the same rules |
| `r` | articles to read, by number, in the order given | numbers that exist in `articles/ids.json` |
| `s` | articles worth a look | the same; `r` and `s` together hold 1 to 50 |
| `f` | personas or collections to start from | persona ids, or `c:<collection>`, up to 10 |
| `n` | a note from the sender | up to 240 characters, shown as text |
| `e` | the sender's address, for a Reply button | an address; the page sends nothing itself |

## What opens

The page reads the fragment, looks each number up in `articles/ids.json`, and shows the list with titles, dates and teasers from the feed. Opening it adds a visitor persona named for the list ("Steve's list, from Dinis") through the meter's public calls, so the reader can keep it as a persona of their own or remove it; nothing is charged for opening a list. A list's persona is keyed by a hash of the names and numbers ([finding R17](https://github.com/SGit-AI/SGit-AI__Website__Newsroom__API/issues/17) notes the hash is 32 bits).

## The make page

`/for/make.html` builds a link from a form: search the articles, add up to 50, move them up and down, name the sender and the reader, write the note, copy the link. It reads its own link back through the recipient's parser, so what the preview shows is what the link opens. An existing link loads into the form for editing.

## What is deliberately not in it

- **A signature.** The names are whatever the link says; a signed list is a later step on the newsroom's keys, and the page says so.
- **A server.** No list is stored anywhere; a link is the whole list.
- **Paying for someone else's reading.** Designed, not built.

## For a site that adopts it

Publish `articles/ids.json` with a stable `n` for every article (the newsroom's `admin/build/ids.py` assigns numbers once, in publication order, and its gate refuses a change) and import `for/reading-list.js` and `for/make.js` from this host on two pages; the newsroom's `for/index.html` and `for/make.html` are the worked examples. The parser's limits are in `LIMITS` at the top of `reading-list.js`; the tests that hold them are `tests/test_lists.mjs`.

