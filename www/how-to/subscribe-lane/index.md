# Set up the subscribe lane

> How shares, subscriptions and notes reach a newsroom without a server: a key pair, a write-only lane in an encrypted vault on an SG/Send host, the contact file at /.well-known/, and reading the lane with the key alone.

*api.newsroom.sgit.ai · v0.2.4 (reader code v0.2.0) · this file is generated from the same source as <https://api.newsroom.sgit.ai/how-to/subscribe-lane/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Set up the subscribe lane

> A reader presses Send; their browser encrypts a small message to your public key and appends it to a lane you own. The site never sees it. You read the lane with your key, by hand or with an agent.

## What you need

1. **A key pair.** An RSA key whose public half is published; the private half stays with whoever (or whichever agent) reads the lane. The envelope is RSA-OAEP-SHA256 wrapping an AES-256-GCM key (the sgit hybrid envelope v2).
2. **A vault with an append lane** on an SG/Send host, with an append token that lets a browser write and nothing else. The newsroom's lane is on `dev.send.sgraph.ai` (named *dev*; finding R5 asks the operator to say whether that is production).
3. **The contact file** at `/.well-known/sgit-subscribe.json`.

## The contact file

```json
{"format": "sgit-subscribe/v1",
 "site": "your-site.example",
 "recipient": {"address": "newsroom@your-site.example", "fingerprint": "<sha256 of the PEM>", "encrypt": "<PEM public key>"},
 "inbox": {"vault": "<vault id>", "endpoint": "https://<sg-send host>", "encrypt_to": "recipient",
           "status": "live", "lane": {"name": "subscribe", "append_token": "<token that can only append>"}}}
```

The browser recomputes the fingerprint from the PEM before encrypting, so a swapped key is refused. The newsroom's own file is [here](https://newsroom.sgit.ai/.well-known/sgit-subscribe.json); it is still labelled with the site the code came from ([finding R4](https://github.com/SGit-AI/SGit-AI__Website__Newsroom__API/issues/4)), which the move makes possible to fix.

## What arrives

A subscription is an `.eml` with the address and a consent line; a share is the reader's summary and their data as JSON (balance, spent, reads, personas, topics, log; never a payment reference), with headers `X-SGit-Form`, `X-SGit-Reply-To`, `X-SGit-Name`, `X-SGit-Subscribe`, `X-SGit-Page`. A note from the vault pane arrives in the reader's own lane, whose read key they hand over, with the page, their words and the phrase they selected.

## Reading the lane

With `sgit` and the read key, from the command line or an agent:

```sh
sgit clone <the lane's read key>          # the notes as files, newest first
NEWSROOM_LANE_KEY=<read key> python3 admin/build/lane.py   # the newsroom's digest, by page; the key from the environment, never a file
```

A read key cannot write: a push from the clone is refused, and the test proves it. The newsroom refuses to hold a vault key for a reader's lane at all.

## The pieces on this host

`assets/subscribe.js` (the form, the fingerprint check, the envelope, the append), the meter's share view in `sg-meter.js`, and the vault layer for notes. The article [The site is an inbox](https://newsroom.sgit.ai/articles/the-site-is-an-inbox.html) is the design of the feedback loop; [Two agents, one vault](https://newsroom.sgit.ai/articles/two-agents-one-vault.html) is how the newsroom's agents share what arrives.

