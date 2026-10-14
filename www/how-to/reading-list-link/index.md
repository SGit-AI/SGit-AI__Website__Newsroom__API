# Make a reading-list link

> Send someone a set of articles as one link, by hand from the grammar or with the make page; what they see when they open it; how a site adds the two pages.

*api.newsroom.sgit.ai · v0.2.0 · this file is generated from the same source as <https://api.newsroom.sgit.ai/how-to/reading-list-link/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Make a reading-list link

> A list is a link. Make it with the page, or type it.

## With the make page

Open [newsroom.sgit.ai/for/make.html](https://newsroom.sgit.ai/for/make.html). Search the articles, add up to fifty, move them up and down, mark some as *worth a look* rather than *to read*, name yourself and the reader, write a note, and copy the link. The preview shows the list exactly as the recipient will see it, because the page reads its own link back through the recipient's parser. Every article page also has a *start a reading list with it* link at its foot, which opens the make page with that article in it.

## By hand

```
https://newsroom.sgit.ai/for/#from=Dinis&to=Steve&r=78,42,15&s=66&n=Read%2078%20first
```

`r` is the articles to read, in order, by number; `s` is worth a look; `from` and `to` are names; `n` is a note. The numbers are in [`articles/ids.json`](https://newsroom.sgit.ai/articles/ids.json), and each article prints its own (*Article No. 78*). The rules, field by field: [the reading-list link](../../docs/reading-list-link/).

## What the recipient sees

The list, with each article's title, date and teaser, in the order you gave; your note; a Reply button if you gave an address. Opening it adds a visitor persona named for the list, which they can keep or remove; nothing is charged for opening it. Anything malformed in the link is dropped and listed under *Left out*, so a mangled link still opens.

## For a site

Two pages that import from this host, and a numbers file:

1. Publish `articles/ids.json` with a stable `n` per article (never changed or reused).
2. `for/index.html`: `import { openList } from 'https://api.newsroom.sgit.ai/{{release}}/for/reading-list.js'` and call `openList({ core, ids: '../articles/ids.json', root: '../', mount })` with `core` the meter core's URL on this host. Load `for/for.css` from this host too.
3. `for/make.html`: the same with `makeList` from `for/make.js` and `site: 'https://your-site/for/'`, the address the links will carry.

The newsroom's `admin/build/lists.py` writes both pages; copy it or the pages it writes.

