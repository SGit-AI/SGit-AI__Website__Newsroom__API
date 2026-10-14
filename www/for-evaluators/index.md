# For evaluators

> The architecture, the trust boundaries, what leaves the browser, the review's findings as public issues, the release manifest, the proof of the move, the pipeline, and how to verify every claim yourself.

*api.newsroom.sgit.ai · v0.2.4 (reader code v0.2.0) · this file is generated from the same source as <https://api.newsroom.sgit.ai/for-evaluators/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# For evaluators

This page is for the person who has to say yes or no. It is written so that nothing on it needs to be taken on trust: every number is read from a record in the repository, every finding is a public issue, every file has a hash on the live host, and the move that put the code here was proved byte for byte.

## The architecture in four sentences

There is no server of ours: the reader code is static files on a host that cannot run code, and the pages that use it are static too. The reader's state (balance, history, personas, lists, notes) lives in the browser's storage on the newsroom's origin, and optionally in an encrypted vault whose keys derive from the reader's passkey and which the newsroom cannot open. Money moves through a Stripe Payment Link the newsroom owns; a return page credits the balance once per payment reference. Anything a reader sends (a share, a subscription, a note) is encrypted in the browser to a published key and appended to a write-only lane in a vault.

## Trust boundaries

PartySeesCannot

The reader's browsereverything: the state is theirs, readable, exportable, editablebe stopped from editing their own balance (accepted; see the security model)

The newsroom (static host)page requests, as any host doessee a balance, a persona, a list or a note; verify a payment

This host (static files)requests for the coderun code, set headers, see any reader data

Stripecard, email, name, postcode, at paymentsee what was read

The vault host (SG/Send)ciphertext, sizes, timesread a share, a note or an account; the keys are the reader's and the newsroom's

The newsroom's agent, with the lane's read keyshares, subscriptions and notes, decryptedwrite to the lane or to a reader's vault

## What leaves the browser

Nine channels, each listed with what, when and who sees it, on [state, inputs and outputs](../docs/state/), read from the map. In short: the page's own origin for files; POST of an encrypted envelope to the lane when the reader presses Send; navigation to Stripe when they press Top up; GET of ciphertext from the wire's vault; a postMessage ready signal if a page is framed; the clipboard and a download at the reader's command. The tests record the hosts a page contacted and fail on any other.

## The accepted gaps, written down

The security model on the newsroom ([meter/security.html]({{newsroom}}/meter/security.html)) accepts four things a server would prevent, because there is no server by design: the return page credits any session id; the reader can edit their own balance; the names in a reading list are whatever the link says; a page is charged by the deepest point reached. The review's job was to prove those are the only gaps.

## The review: {{findings}} findings, each a public issue

Before the code moved here it was mapped and reviewed line by line, the way [a fractal semantic graph]({{newsroom}}/articles/code-review-as-a-fractal-semantic-graph.html) is read: every file, every control a reader can click, type or pay, every input and output, every contract, then every function the findings name. The findings are [issues 1 to 18]({{github}}/issues) in the repository, labelled by phase, area and severity. Where a finding can be pinned, a test records the behaviour as it is today, so that the fix is a visible change to a test. The three a security evaluator will want first:

- No Content-Security-Policy on any page ([R10]({{github}}/issues/10), high). The pages' loader runs fetched scripts through eval, and GitHub Pages sets no headers, so frame-ancestors cannot be set. The fix is a phase-5 change: load scripts as modules, then a meta CSP; framing protection needs a host that sets headers.

- Payment references unbounded and unchecked ([R14]({{github}}/issues/14), low) and restore() trusts a file's fields ([R2]({{github}}/issues/2), low): the exposure is a file someone sent the reader to restore.

- Production reader data goes to hosts named dev ([R5]({{github}}/issues/5)): a naming decision for the operator, listed so that nobody is surprised.

[The full table](../review/), with the test that pins each and the proposed change.

## Supply chain

- Third-party scripts on the reader pages: none. The build fails if one appears (the brief's rule).

- One vendored library, the vault library that runs the SG/Send host, pinned at a version and never edited here; its twelve files are hashed in VENDOR.md and the test checks them.

- Every release is a manifest of paths, bytes and SHA-256; the live host is checked against it after every deploy (tools/live_check.py), because [green does not mean live]({{newsroom}}/articles/green-does-not-mean-live.html).

- Nothing is edited in place. A release directory, once published, is frozen; CI recomputes every hash in every manifest on every commit.

## The proof of the move

This code lived in the newsroom's repository until 13 October 2026. Moving it to a host of its own was done as a pure refactoring, and proved: of {{files}} files, 60 hash exactly as they did before, and the three that differ do so by the lines that located the site root from the script's own address, each recorded in the manifest with its before-hash and the reason; of 597 pages on the newsroom, 593 normalise to what they were. [The proof](../review/proof/), with the report it was written from.

## The pipeline

Every commit: syntax, the manifest, a build that is the same bytes twice, and the tests in Chromium, WebKit and Firefox against the newsroom's real pages, in about four minutes. Every push to main: a tag, the Pages deploy, and the live check. A pull request needs a person and an agent reviewer. [The runs]({{github}}/actions).

## Verify it yourself

# every file of the current release, with its hash, from the live host
python3 - <<'END'
import json, hashlib, urllib.request
host = "https://api.newsroom.sgit.ai/{{release}}/"
m = json.load(urllib.request.urlopen(host + "manifest.json"))
for f in m["files"]:
    b = urllib.request.urlopen(host + f["path"]).read()
    print("ok " if hashlib.sha256(b).hexdigest() == f["sha256"] else "BAD", f["path"])
END

# the same, from the repository's own tool
git clone {{github}} && cd SGit-AI__Website__Newsroom__API && python3 tools/live_check.py
The newsroom's gate does the equivalent on its side: every page must load the reader code from the pinned release, by a URL that is in the manifest, and never by a relative path. Its source is [public]({{newsroom_github}}) too.

## Licence and provenance

Apache 2.0. The code was written by the newsroom's agents under Dinis Cruz's editorial and engineering responsibility, as every page on newsroom.sgit.ai discloses; the review was done by agents and is open to people, which is what the issues are for. [About, licence, contact](../about/).
