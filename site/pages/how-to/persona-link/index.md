---
title: Open the newsroom as a persona
description: Persona links, persona pages and links.json: how a link opens the site as a founder, a journalist, a security lead, a builder or a board member, what a visitor persona is, and how a site defines its presets.
section: How-to
crumbs: [How-to|how-to/]
eyebrow: How-to
agent: Persona links: /persona/<id>/ and /persona/#<id> for the five presets (founder, journalist, security, builder, board); the landing view adds the persona as a visitor the reader can keep or remove, charges nothing; presets are defined in the meter config (id, label, name, theme, blurb, topics, articles); persona/links.json lists them; the newsroom's personas.py writes the pages.
---
# Open the newsroom as a persona

> A link that says who you are reading as. The reader can keep the persona or send it away; nothing is charged for arriving.

## The links

```
https://newsroom.sgit.ai/persona/founder/
https://newsroom.sgit.ai/persona/#journalist
```

Five starting personas: `founder` (Morgan), `journalist` (Rowan), `security` (Sam), `builder` (Kai), `board` (Jordan). [`persona/links.json`](https://newsroom.sgit.ai/persona/links.json) lists them with their pages, for whoever writes the email. The picker at [`/persona/`](https://newsroom.sgit.ai/persona/) shows all five; an unknown id is said so, and nothing is added.

## What happens

The page's meter is in its `landing` view. It adds the persona as a *visitor*: active, with its starting reading list and picks, but marked as arrived by a link. The page says who you are reading as and offers *Keep* (it becomes one of the reader's own) and *Remove* (it goes, and the others stay). Opening the link twice adds nothing twice. The article [A link to a persona](https://newsroom.sgit.ai/articles/a-link-to-a-persona.html) is the design, with the vault as the step after it.

## Defining the presets

Each preset is an entry in the meter config's `personas.presets`: `id`, `label`, `name`, `theme` (a hex colour), `blurb`, `topics` (weights by topic) and `articles` (the starting list, by slug). A persona added to the config gets its page and its row in `links.json` on the next build. The newsroom's `admin/build/personas.py` writes `persona/index.html`, one page per preset, and `links.json`; its pages carry the meter block with `view="landing"` and the id in the address.

## What a persona does afterwards

It curates: *Keep* and *Not for this persona* on any reader card move an article onto or off its lists, and the picks on the newsroom page follow what it kept. A page read is credited to the active persona. A reading list opened from a link is a persona of this kind too, named for the list.
