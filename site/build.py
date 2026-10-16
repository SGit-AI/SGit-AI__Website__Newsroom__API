#!/usr/bin/env python3
"""The website on api.newsroom.sgit.ai: for publishers, developers and evaluators, and for the agents that keep it.

    python3 site/build.py                          # writes www/ from site/pages/*.md, site/data/ and the repository's own records
    python3 site/build.py --refresh-articles DIR   # also refresh site/data/articles.json from a newsroom checkout (articles/graphs.json)
    python3 site/build.py --check                  # build into a temporary directory and fail if www/ differs (CI)

Everything on the site is generated from sources a person or an agent can edit: markdown pages with front matter
(site/pages/), the article feed copied from the newsroom (site/data/articles.json), the map of what a reader runs
(map/before/<release>/map.json), the release manifests (releases/*/manifest.json) and the proof of the move
(map/proof/). Nothing is typed twice: a count, a contract or a finding on a page is read from its record.

The pages are static HTML with one stylesheet and a few lines of script (copy buttons, the map's graph). Every page
has a .md twin, an agent block, a canonical URL and its place in llms.txt and sitemap.xml, as the newsroom's pages do.
"""
import argparse
import html as htmlmod
import json
from html.parser import HTMLParser
import re
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from md import front_matter, render  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PAGES = ROOT / "site/pages"
DATA = ROOT / "site/data"
CONTENT = ROOT / "site/content/articles"   # articles written here, in the newsroom's article format (its admin/content/articles/README.md)
OUT = ROOT / "www"
HOST = "api.newsroom.sgit.ai"
SITE = f"https://{HOST}"
NEWSROOM = "https://newsroom.sgit.ai"
GITHUB = "https://github.com/SGit-AI/SGit-AI__Website__Newsroom__API"
NEWSROOM_GITHUB = "https://github.com/SGit-AI/SGit-AI__Website__Newsroom"
VERSION = json.loads((ROOT / "tools/version.json").read_text(encoding="utf-8"))
RELEASE = VERSION["release"]          # the reader-code release the consuming sites pin (releases/<release>/)
SITE_VERSION = VERSION["version"]     # the repository's version: every change that lands on dev, tagged by the deploy
BEFORE = sorted((ROOT / "map/before").glob("v*"))[-1]
MAP = json.loads((BEFORE / "map.json").read_text(encoding="utf-8"))
MANIFESTS = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "releases").glob("v*/manifest.json"),
             key=lambda p: [int(x) for x in p.parent.name[1:].split(".")])]
PROOFS = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "map/proof").glob("v*.json"))}
ARTICLES = json.loads((DATA / "articles.json").read_text(encoding="utf-8")) if (DATA / "articles.json").exists() else {"articles": []}
ISSUES = {f"R{i}": i for i in range(1, 19)}      # finding Rn is issue n in this repository, filed 13 October 2026

esc = lambda s: htmlmod.escape(str(s), quote=True)  # noqa: E731

# The bar: groups with their pages under them, as the newsroom's bar has (chrome.py there); a group is "here" by the path's prefix.
NAV = [
    ("Start", "for-developers/", [("For publishers and editors", "for-publishers/"), ("For developers", "for-developers/"), ("For evaluators", "for-evaluators/"), ("Adopt it", "adopt/")]),
    ("Docs", "docs/", [("The reference", "docs/"), ("The contracts", "docs/contracts/"), ("State, inputs and outputs", "docs/state/"), ("The components", "docs/components/"),
                       ("Hosting and CORS", "docs/hosting/"), ("The reading-list link", "docs/reading-list-link/")]),
    ("How-to", "how-to/", [("All the guides", "how-to/"), ("Add the meter", "how-to/add-the-meter/"), ("A persona link", "how-to/persona-link/"), ("A reading-list link", "how-to/reading-list-link/"),
                           ("The subscribe lane", "how-to/subscribe-lane/"), ("Run the tests", "how-to/run-the-tests/"), ("Take a release", "how-to/take-a-release/"), ("Make a release", "how-to/make-a-release/")]),
    ("Review", "review/", [("The map, and the review", "review/"), ("The map as a graph", "review/map/"), ("The proof of the move", "review/proof/"), ("The findings, as issues", "https://github.com/SGit-AI/SGit-AI__Website__Newsroom__API/issues")]),
    ("Releases", "releases/", [("Releases", "releases/"), ("Versions", "versions/"), ("The feed", "feed.xml"), ("releases.json", "releases.json")]),
    ("Articles", "articles/", []),
    ("Agents", "agents/", []),
    ("About", "about/", []),
]


# ------------------------------------------------------------------------------------------------------------ frame
def page_html(rel, meta, body, *, md_twin):
    up = "../" * rel.count("/")
    canonical = SITE + "/" + ("" if rel == "index.html" else rel.replace("index.html", ""))
    title = meta["title"]
    description = meta.get("description", "")
    section = meta.get("section", "")
    eyebrow = meta.get("eyebrow", "")
    agent = meta.get("agent", description)
    def nav_html():
        out = []
        for label, href, subs in NAV:
            here = rel.startswith(href) or (label == "Start" and rel.split("/")[0] in ("for-publishers", "for-evaluators", "adopt"))
            if subs:
                links = "".join(f'<a class="sl{" here" if rel.replace("index.html", "") == h else ""}" href="{h if h.startswith("http") else up + h}">{esc(t)}</a>' for t, h in subs)
                out.append(f'<div class="ni ni-has{" here" if here else ""}"><a class="nl" href="{up}{href}">{esc(label)}<span class="caret" aria-hidden="true"> &#9662;</span></a><div class="sub">{links}</div></div>')
            else:
                out.append(f'<div class="ni{" here" if here else ""}"><a class="nl" href="{up}{href}">{esc(label)}</a></div>')
        return "".join(out)
    nav = nav_html()
    # crumbs: pairs (label, path from the root); in front matter written as [Label|path/, …]
    crumbs = [tuple(c.split("|", 1)) if isinstance(c, str) else tuple(c) for c in meta.get("crumbs", [])]
    trail = "".join(f'<a href="{up}{h}">{esc(t)}</a> / ' for t, h in crumbs)
    wide = " wide" if meta.get("wide") else ""
    og_slug = "home" if rel == "index.html" else rel.replace("/index.html", "").removesuffix(".html").replace("/", "-")   # as site/og.py names the cards
    return f"""<!doctype html>
<html lang="en" data-root="{up}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · {HOST}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" type="text/markdown" href="{md_twin}" title="This page as markdown">
<link rel="alternate" type="application/rss+xml" href="{SITE}/feed.xml" title="Versions and releases">
<meta property="og:type" content="website"><meta property="og:site_name" content="SGit Newsroom API">
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(description)}"><meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE}/og/{og_slug}.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="{esc(title)}, on api.newsroom.sgit.ai">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{SITE}/og/{og_slug}.jpg">
<meta name="theme-color" content="#faf9f5" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
<link rel="icon" href="{up}assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{up}assets/site.css">
<link rel="stylesheet" href="{up}assets/themes.css">
<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@type": meta.get("ld_type", "WebPage"), "name": title, "description": description, "url": canonical, "image": f"{SITE}/og/{og_slug}.jpg", "inLanguage": "en",
                                                  **({"headline": title, "datePublished": meta["date"]} if meta.get("ld_type") == "Article" else {}),
                                                  "author": meta.get("ld_author") or {"@type": "Person", "name": "Dinis Cruz", "url": "https://docs.diniscruz.ai"},
                                                  "editor": {"@type": "Person", "name": "Dinis Cruz", "url": "https://docs.diniscruz.ai"}, "publisher": {"@type": "Organization", "name": "sgit.ai", "url": "https://sgit.ai"},
                                                  "about": {"@type": "SoftwareApplication", "name": "SGit Newsroom API", "applicationCategory": "DeveloperApplication", "url": SITE + "/"},
                                                  "isPartOf": {"@type": "WebSite", "name": "SGit Newsroom API", "url": SITE + "/"}, "license": "https://www.apache.org/licenses/LICENSE-2.0"})}</script>
</head>
<body>
<script src="{up}assets/themes.js"></script>
<a class="skip" href="#main">Skip to the content</a>
<header class="top"><div class="row">
  <a class="brand" href="{up}index.html"><span class="mark" aria-hidden="true"></span><span class="name">api<span class="host">.newsroom.sgit.ai</span></span></a>
  <a class="ver" href="{up}versions/" title="This site is {esc(SITE_VERSION)}; the reader code it serves is release {esc(RELEASE)}. Every version, in a line">{esc(SITE_VERSION)}</a>
  <button class="menu" type="button" aria-expanded="false" aria-controls="nav">Menu</button>
  <nav id="nav" class="nav">{nav}</nav>
  <div class="tools"><a class="search-btn" href="{up}search/" title="Search this site, in your browser">Search</a><div class="theme-pick"></div><a class="gh" href="{GITHUB}" title="The source, on GitHub">★<span class="lbl">GitHub</span></a></div>
</div></header>
<main id="main" class="doc{wide}">
<p class="crumb"><a href="{up}index.html">Home</a> / {trail}{esc(meta.get("crumb_title", title)) if not meta.get("no_crumb_title") else ""}</p>
{f'<p class="eyebrow">{esc(eyebrow)}</p>' if eyebrow else ''}
{body}
<aside class="agent" aria-label="For agents">
 <p><b>For agents.</b> {esc(agent)} This page as markdown: <a href="{md_twin}">{md_twin}</a>. The site's index: <a href="{up}llms.txt">llms.txt</a>; the whole site in one fetch: <a href="{up}llms-full.txt">llms-full.txt</a>. The reader code this site describes is served at <code>{SITE}/{RELEASE}/&lt;path&gt;</code>; its manifest: <a href="{up}{RELEASE}/manifest.json">{RELEASE}/manifest.json</a>.</p>
</aside>
</main>
<footer class="foot"><div class="cols">
  <div class="about">
    <div class="brandline">api<span>.newsroom.sgit.ai</span></div>
    <p>The SGit Newsroom's reader, as an API: the components, formats and contracts the browser runs on <a href="{NEWSROOM}/">newsroom.sgit.ai</a>, with no server and nothing to deploy but files, published here as releases a site pins. Made by the newsroom's agents under the editorial and engineering responsibility of Dinis Cruz; the method, the review and the tests are public so that anyone can run a newsroom like it. Part of the <a href="https://sgit.ai"><b>sgit.ai</b></a> network. The code is Apache 2.0; these pages CC BY 4.0.</p>
    <p class="netline"><a href="https://sgit.ai"><b>&#8593; sgit.ai</b></a> &middot; <a href="{NEWSROOM}/">&#8593; newsroom.sgit.ai</a> &middot; <a href="https://pt.newsroom.sgit.ai">&#8593; pt.newsroom.sgit.ai</a> &middot; <a href="https://graphs.sgit.ai">&#8593; graphs.sgit.ai</a> &middot; <a href="https://pki.sgit.ai">&#8593; pki.sgit.ai</a> &middot; <a href="https://nhi.sgit.ai">&#8593; nhi.sgit.ai</a> &middot; <a href="https://docs.diniscruz.ai">&#8593; docs.diniscruz.ai</a> &mdash; the prior art</p>
    <p class="partnote">&#9888; Participant disclosure: published by the sgit project, which is building the stack this site argues for. <a href="{NEWSROOM}/about/participant.html">Read the disclosure</a>.</p>
    <p class="verline">site <a href="{up}versions/">{esc(SITE_VERSION)}</a> &middot; reader code <a href="{up}releases/#{esc(RELEASE)}">{esc(RELEASE)}</a> &middot; <a href="{GITHUB}">engineering</a> &middot; <a href="{md_twin}">this page as markdown</a></p>
  </div>
  <div><h4>The API</h4><a href="{up}for-developers/">Quick start</a><a href="{up}docs/">Reference</a><a href="{up}how-to/">How-to guides</a><a href="{up}releases/">Releases</a><a href="{up}versions/">Versions</a><a href="{up}{RELEASE}/manifest.json">Current manifest</a></div>
  <div><h4>The case</h4><a href="{up}for-publishers/">For publishers and editors</a><a href="{up}for-evaluators/">For evaluators</a><a href="{up}adopt/">Adopt it</a><a href="{up}articles/">The articles behind it</a></div>
  <div><h4>The work</h4><a href="{up}review/">The map and the review</a><a href="{up}review/proof/">The proof of the move</a><a href="{GITHUB}/issues">Issues</a><a href="{GITHUB}">Source</a><a href="{up}agents/">For agents</a></div>
  <div><h4>Live</h4><a href="{NEWSROOM}/">newsroom.sgit.ai</a><a href="{NEWSROOM}/meter/">SG Meter, documented</a><a href="{NEWSROOM}/newsroom-api/">The reader API map</a><a href="{up}about/">About, licence, contact</a></div>
</div>
</footer>
<script src="{up}assets/site.js" defer></script>
</body>
</html>
"""


def page_md(rel, meta, md_body):
    canonical = SITE + "/" + ("" if rel == "index.html" else rel.replace("index.html", ""))
    return (f"# {meta['title']}\n\n> {meta.get('description', '')}\n\n*{HOST} · {SITE_VERSION} (reader code {RELEASE}) · this file is generated from the same source as "
            f"<{canonical}>, so the two cannot drift. The site's index for agents: <{SITE}/llms.txt>.*\n\n---\n\n{md_body}\n")


# ------------------------------------------------------------------------------------------------------------ pieces
def card(title, href, text, *, tag=""):
    return (f'<a class="card" href="{href}">{f"<span class=tag>{esc(tag)}</span>" if tag else ""}<h3>{esc(title)}</h3><p>{text}</p></a>')


def table(headers, rows, *, cls=""):
    th = "".join(f"<th>{h}</th>" for h in headers)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="tablewrap"><table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'


def code(text, lang=""):
    return f'<pre class="code" data-lang="{esc(lang)}"><button class="copy" type="button" aria-label="Copy">Copy</button><code>{esc(text)}</code></pre>'


def article(slug):
    for a in ARTICLES["articles"]:
        if a["slug"] == slug:
            return a
    return None


def article_card(a, *, why=""):
    return (f'<a class="card article" href="{a["url"]}"><span class="tag">No. {a.get("n", "")} · {a["date"]}</span>'
            f'<h3>{esc(a["title"].split(":")[0])}</h3><p>{esc(a["teaser"])}</p>{f"<p class=why>{why}</p>" if why else ""}</a>')


def live(text):
    return f'<p class="live"><span class="dot" aria-hidden="true"></span><span>{text}</span></p>'


# ------------------------------------------------------------------------------------------------------------ data pages
def contracts_page():
    rows = []
    for c in MAP["contracts"]:
        rows.append([f"<b>{esc(c['contract'])}</b>", esc(c["shape"]), f"<code>{esc(c['owner'])}</code>"])
    body = ("<h1>The contracts</h1>\n<p class=\"lead\">What other sites, pages and agents program against. Fourteen, read from the map of "
            f"everything a reader runs at newsroom {esc(MAP['release'])}; the two that other sites and agents already program against are the "
            "reading-list link and <code>articles/ids.json</code>. A contract changes only with a new release, and never in place.</p>\n"
            + table(["Contract", "Shape", "Owner"], rows, cls="contracts")
            + "\n<h2>The two formats the newsroom publishes for this API</h2>\n<ul>"
            f'<li><b>Article numbers</b>: <a href="{NEWSROOM}/articles/ids.json">articles/ids.json</a>. <code>n</code> and <code>slug</code> are the contract: assigned once, '
            "in publication order, never changed or reused; every other field is display text. A reading list names articles by number.</li>"
            f'<li><b>Persona links</b>: <a href="{NEWSROOM}/persona/links.json">persona/links.json</a>: one entry per starting persona, with its page.</li></ul>\n'
            "<h2>Events</h2>\n<p>The meter emits DOM events a page or another component can listen to: <code>sg:meter.changed</code>, <code>charged</code>, <code>rated</code>, "
            "<code>declined</code>, <code>toppedup</code>, <code>reset</code>, <code>restored</code>, <code>persona</code>, <code>shared</code>; and <code>sg-meter:error</code> when it fails.</p>\n")
    md = "## The contracts\n\n| Contract | Shape | Owner |\n|---|---|---|\n" + "\n".join(
        f"| {c['contract']} | {c['shape'].replace('|', '/')} | `{c['owner']}` |" for c in MAP["contracts"])
    return body, md


def state_page():
    rows = [[f"<code>{esc(s['field'])}</code>", esc(s["holds"])] for s in MAP["state"]]
    inputs = [[f"<b>{esc(i['input'])}</b>", esc(i["what"]), esc(i["who"]), f"<code>{esc(i['where'])}</code>"] for i in MAP["inputs"]]
    outputs = [[f"<b>{esc(o['channel'])}</b>", esc(o["what"]), esc(o["when"]), esc(o["who_sees"])] for o in MAP["outputs"]]
    body = ("<h1>State, inputs and outputs</h1>\n<p class=\"lead\">Where a reader's data lives, what comes in, and every place anything leaves the browser. "
            "From the map, which the review checks line by line.</p>\n"
            "<h2>The state, in <code>localStorage</code> under <code>sgit.meter.v1</code></h2>\n<p>It belongs to the page's origin (newsroom.sgit.ai), whichever host serves the script. "
            "A reader can read it, export it, restore it and edit it; the security model says so.</p>\n" + table(["Field", "Holds"], rows)
            + "\n<h2>What comes in</h2>\n" + table(["Input", "What", "Who", "Where"], inputs)
            + "\n<h2>What leaves the browser</h2>\n" + table(["Channel", "What", "When", "Who sees it"], outputs)
            + f'\n<p>The accepted gaps and why: <a href="{NEWSROOM}/meter/security.html">the meter\'s security model</a>.</p>\n')
    md = ("## State\n\n" + "\n".join(f"- `{s['field']}`: {s['holds']}" for s in MAP["state"]) + "\n\n## Inputs\n\n"
          + "\n".join(f"- **{i['input']}**: {i['what']} ({i['who']}; `{i['where']}`)" for i in MAP["inputs"]) + "\n\n## Outputs\n\n"
          + "\n".join(f"- **{o['channel']}**: {o['what']}; {o['when']}; seen by {o['who_sees']}" for o in MAP["outputs"]))
    return body, md


SEVERITY_ORDER = {"high": 0, "high for the move": 0, "high per the brief": 0, "medium": 1, "low": 2, "question": 3, "note": 3, "note for the move": 3, "process": 3}


def findings_rows(limit=None):
    rows = []
    fs = sorted(MAP["findings"], key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), int(f["id"][1:])))
    for f in fs[:limit] if limit else fs:
        n = ISSUES.get(f["id"])
        rows.append([f'<a href="{GITHUB}/issues/{n}"><b>{esc(f["id"])}</b></a>', f'<span class="sev sev-{esc(f["severity"].split()[0])}">{esc(f["severity"])}</span>',
                     esc(f["area"]), esc(f["finding"]), esc(f["pinned_by"]), esc(f["proposed"])])
    return rows


def review_page():
    c = MAP["counts"]
    kpis = [("reader code", f"{c['reader_code_lines']:,} lines", f"in {c['reader_files']} files that run in a browser"),
            ("frozen", f"{c['frozen_lines']:,} lines", f"in {c['frozen_files']} files of earlier meter versions, served and never changed"),
            ("surface", f"{c['controls']} controls", f"{c['views']} views on {c['pages']} pages; {c['inputs']} inputs, {c['outputs']} outputs"),
            ("contracts", str(c["contracts"]), "formats other sites and agents program against"),
            ("findings", str(c["findings"]), "each an issue here, each pinned by a test where it can be"),
            ("tests", f"{c['tests']} checks", "in eleven files, run in three engines on every commit")]
    kp = "".join(f'<div class="kpi"><span class="k">{esc(k)}</span><span class="v">{esc(v)}</span><span class="d">{esc(d)}</span></div>' for k, v, d in kpis)
    body = (f"<h1>The map, and the review</h1>\n<p class=\"lead\">Before anything moved, everything a reader does on newsroom.sgit.ai was mapped: every file, every "
            "control a reader can click, type or pay, every input, every place data leaves the browser, every contract. Then it was reviewed line by line. The map is "
            f"regenerated from the tree; this is the one from newsroom {esc(MAP['release'])}, the before of the move, and the review's eighteen findings are this repository's first eighteen issues.</p>\n"
            f'<div class="kpis">{kp}</div>\n'
            + live(f'The map as a page: <a href="{NEWSROOM}/newsroom-api/">newsroom.sgit.ai/newsroom-api/</a>; as data: <a href="../map/before/{BEFORE.name}/map.json">map.json</a>.')
            + "\n<h2>How the review reads the code</h2>\n<p>Source code is layers within layers, each a graph with its own vocabulary, and a review should read a change at every one: "
            "that is the method in <a href=\"https://newsroom.sgit.ai/articles/code-review-as-a-fractal-semantic-graph.html\">Code review as a fractal semantic graph</a>. "
            "Here the layers are: the site a reader opens; the pages written for the reader code; the views, controls, inputs and outputs on them; the files that run them and the "
            "contracts between them; and inside each file the functions the findings name. <a href=\"map/\">The map as a graph</a> draws those layers and the edges between them, "
            "and every finding is anchored to a node.</p>\n"
            "<h2>The findings</h2>\n<p>Severity first, then by number. Each links to its issue; <i>pinned by</i> names the test that records the behaviour as it is today, "
            "so that the fix later is a visible change to a test and not a silent one (the brief's rule 3).</p>\n"
            + table(["Finding", "Severity", "Area", "What", "Pinned by", "Proposed change"], findings_rows(), cls="findings")
            + "\n<h2>Accepted, and said so</h2>\n<p>Gaps the design accepts, each written where a reader can find it.</p>\n"
            + table(["Gap", "Why", "Where"], [[esc(a["gap"]), esc(a["why"]), f"<code>{esc(a['where'])}</code>"] for a in MAP["accepted"]])
            + '\n<h2>Where the move left things</h2>\n<ul><li><a href="proof/">The proof of the move</a>: the same bytes, before and after.</li>'
            '<li><a href="../docs/state/">State, inputs and outputs</a>, from the same map.</li><li><a href="../docs/contracts/">The contracts</a>.</li></ul>\n')
    md = ("## The findings\n\n| Finding | Severity | Area | What | Pinned by | Proposed |\n|---|---|---|---|---|---|\n" + "\n".join(
        f"| [{f['id']}]({GITHUB}/issues/{ISSUES.get(f['id'])}) | {f['severity']} | {f['area']} | {f['finding'].replace('|', '/')} | {f['pinned_by'].replace('|', '/')} | {f['proposed'].replace('|', '/')} |"
        for f in MAP["findings"]))
    return body, md


def map_graph_json():
    """The map as a layered graph: site → pages → (views, controls, inputs, outputs) → files → contracts, with findings anchored."""
    nodes, edges = [], []
    add = lambda i, layer, label, **k: nodes.append({"id": i, "layer": layer, "label": label, **k})  # noqa: E731
    add("site", 0, "newsroom.sgit.ai", kind="site")
    for p in MAP["pages"]:
        add("page:" + p["path"], 1, p["path"], kind="page", what=p.get("what", "")); edges.append(["site", "page:" + p["path"]])
    # the current meter: the newest sg-meter.js in the map by version (v1.4.1 at v0.12.50), never a hard-coded one
    meter_js = max((f["path"] for f in MAP["files"] if f["path"].endswith("/sg-meter.js")),
                   key=lambda s: [int(x) for x in s.split("/")[-2][1:].split(".")])
    for view, count in MAP.get("views_on_pages", {}).items():
        vid = "view:" + view
        add(vid, 2, f"view {view}", kind="view", what=f"the meter's {view} view, on {count} page(s)")
        edges.append([vid, "file:" + meter_js])
        for p in MAP["pages"]:
            if view in ("page",) or view in p["path"] or (view == "landing" and "persona" in p["path"]) or (view == "topup" and "top-up" in p["path"]):
                edges.append(["page:" + p["path"], vid])
    for f in MAP["files"]:
        add("file:" + f["path"], 3, f["path"].split("/")[-1], kind="file", path=f["path"], lines=f["lines"], what=f.get("what", ""))
    for c in MAP["contracts"]:
        cid = "contract:" + c["contract"]
        add(cid, 4, c["contract"], kind="contract", shape=c["shape"], owner=c["owner"])
        for f in MAP["files"]:
            if f["path"].split("/")[-1].split(".")[0] in c["owner"] or f["path"] in c["owner"]:
                edges.append(["file:" + f["path"], cid])
    for fnd in MAP["findings"]:
        fid = "finding:" + fnd["id"]
        add(fid, 5, fnd["id"], kind="finding", severity=fnd["severity"], text=fnd["finding"], issue=ISSUES.get(fnd["id"]))
        for f in MAP["files"]:
            if f["path"].split("/")[-1] in fnd["evidence"]:
                edges.append(["file:" + f["path"], fid])
    # pages → the files they load, by the loader and the chrome, as the map's files table says
    core = [f["path"] for f in MAP["files"] if "sg-meter" in f["path"] and "v1.4" in f["path"]]
    for p in MAP["pages"]:
        for cf in core[:2]:
            edges.append(["page:" + p["path"], "file:" + cf])
    layers = ["the site", "the pages", "the views", "the files", "the contracts", "the findings"]
    return {"what": "The map of what a reader runs, as a layered graph (site, pages, views, files, contracts, findings); drawn by assets/site.js on /review/map/.",
            "release": MAP["release"], "layers": layers, "nodes": nodes, "edges": edges}


def map_page():
    body = ("<h1>The map as a graph</h1>\n<p class=\"lead\">The same map, drawn as the layers a review reads: the site, the pages a reader opens, the views on them, the files that "
            "run them, the contracts between them, and the findings anchored to the files they are about. Hover or tap a node for what it is; the data is "
            "<a href=\"graph.json\">graph.json</a>.</p>\n<div class=\"graph\" id=\"map-graph\" data-src=\"graph.json\" role=\"img\" aria-label=\"The map of the reader code as a layered graph\">"
            "<noscript><p>The graph is drawn by a script; the data is graph.json and the tables are on the review page.</p></noscript></div>\n"
            "<p class=\"dim\">A layer is a vocabulary of its own: a page has an address and a purpose; a view has controls; a file has lines and the hosts it reaches; a contract has a shape "
            "and an owner; a finding has a severity and a test. Reading a change at every layer is the review method this repository follows.</p>\n")
    g = map_graph_json()
    md = "## Layers\n\n" + "\n".join(f"- {l}: {sum(1 for n in g['nodes'] if n['layer'] == i)} node(s)" for i, l in enumerate(g["layers"])) + f"\n\nThe data: <{SITE}/review/map/graph.json>."
    return body, md


def proof_page():
    if not PROOFS:
        return "<h1>The proof of the move</h1><p>No proof has been written yet.</p>", "No proof yet."
    parts = ["<h1>The proof of the move</h1>\n<p class=\"lead\">The brief's rule for the move is that the live site serves the same bytes before and after, proved by hash and not by "
             "reading a diff: scripts, styles and JSON raw; pages with the chrome and the version stamps normalised, plus the one rule the move added (a reader-file reference, relative "
             "or on this host, reads the same). This is that proof, per release, written by <code>tools/prove_move.py</code>.</p>\n"]
    for rel, pr in sorted(PROOFS.items()):
        f, z, g = pr["files"], pr["frozen"], pr["pages"]
        parts.append(f"<h2>{esc(rel)}</h2>\n<div class=\"kpis\">"
                     f'<div class="kpi"><span class="k">files</span><span class="v">{f["same"]} identical</span><span class="d">{len(f["changed_as_recorded"])} changed as the manifest records, {len(f["unexpected"])} unexpected</span></div>'
                     f'<div class="kpi"><span class="k">frozen copies</span><span class="v">{z["same"]} identical</span><span class="d">the newsroom\'s copies of the earlier meter versions</span></div>'
                     f'<div class="kpi"><span class="k">pages</span><span class="v">{g["same"]} of {g["compared"]}</span><span class="d">identical once normalised; {len(g["differ"])} differ, {len(g["only_after"])} new</span></div></div>\n')
        if f["changed_as_recorded"]:
            parts.append("<h3>Changed, as recorded</h3><p>The files a host of their own forced to change, each by the lines that located the site root from the script's own address:</p><ul>"
                         + "".join(f"<li><code>{esc(x)}</code></li>" for x in f["changed_as_recorded"]) + "</ul>")
        if g["differ"]:
            parts.append("<h3>Pages that differ</h3><p>The release's own pages, with the first differing line of each:</p>"
                         + table(["Page", "First difference"], [[f"<code>{esc(d['page'])}</code>", f"<code>{esc(d['first_difference'][:160])}</code>"] for d in g["differ"]]))
        if g["only_after"]:
            parts.append("<p>New pages: " + ", ".join(f"<code>{esc(x)}</code>" for x in g["only_after"]) + ".</p>")
        parts.append(f'<p>The report: <a href="../../map/proof/{esc(rel)}.json">map/proof/{esc(rel)}.json</a>; the before: <a href="../../map/before/{BEFORE.name}/hashes.json">every file\'s raw hash at newsroom {esc(MAP["release"])}</a>.</p>')
    md = "\n".join(f"## {rel}\n\n- files: {pr['files']['same']} identical, {len(pr['files']['changed_as_recorded'])} changed as recorded, {len(pr['files']['unexpected'])} unexpected\n"
                   f"- frozen copies: {pr['frozen']['same']} identical\n- pages: {pr['pages']['same']} of {pr['pages']['compared']} identical once normalised" for rel, pr in sorted(PROOFS.items()))
    return "\n".join(parts), md


def releases_page():
    parts = ["<h1>Releases</h1>\n<p class=\"lead\">A release is a directory on this host that is never changed after it is published: "
             f"<code>{SITE}/&lt;release&gt;/&lt;path&gt;</code>, with a manifest of every path and its SHA-256. A consuming site pins one release and copies its manifest; "
             "a rollback is the previous release in the pin. <a href=\"../releases.json\">releases.json</a> lists them for machines.</p>\n"]
    for m in reversed(MANIFESTS):
        changed = [f for f in m["files"] if "changed_from_newsroom" in f]
        parts.append(f"<h2 id=\"{esc(m['release'])}\">{esc(m['release'])} <span class=\"dim\">· {esc(m['date'])}</span></h2>\n"
                     f"<p>{m['counts']['files']} files, {m['counts']['bytes']:,} bytes. <a href=\"../{esc(m['release'])}/manifest.json\">manifest.json</a>.</p>\n")
        note = (ROOT / "site/releases" / f"{m['release']}.md")
        if note.exists():
            parts.append(render(front_matter(note.read_text(encoding='utf-8'))[1]))
        if changed:
            parts.append("<details><summary>Files that differ from the newsroom's bytes, and why</summary>" + table(["File", "Why"], [[f"<code>{esc(f['path'])}</code>", esc(f["changed_from_newsroom"]["why"])] for f in changed]) + "</details>")
        parts.append("<details><summary>Every file in the release</summary>" + table(["Path", "Bytes", "SHA-256"], [[f"<code>{esc(f['path'])}</code>", f"{f['bytes']:,}", f"<code class=hash>{esc(f['sha256'])}</code>"] for f in m["files"]]) + "</details>")
    md = "\n".join(f"## {m['release']} ({m['date']})\n\n{m['counts']['files']} files, {m['counts']['bytes']:,} bytes. Manifest: <{SITE}/{m['release']}/manifest.json>." for m in reversed(MANIFESTS))
    return "\n".join(parts), md


CURATED = [
    ("The case", [
        ("future-of-news-story-vault-not-paywall", "Why a newsroom would want this at all."),
        ("a-meter-in-the-browser", "The reading meter, as it was built."),
        ("pay-after-you-read", "Paying after you read, with a rating that sets the price."),
        ("going-live-with-the-reading-meter", "Real money, and the line between what runs and what is designed."),
        ("who-will-game-the-reading-meter", "The threat model, written before the first pound."),
        ("no-server-by-design", "Why there is no server of ours, and what that buys a reader."),
    ]),
    ("The reader's own newsroom", [
        ("a-link-to-a-persona", "A link that opens the newsroom as a persona."),
        ("pay-to-keep-your-persona", "What a persona is worth, and to whom."),
        ("a-reading-list-in-a-link", "From me to you, in a link: the reading-list grammar."),
        ("i-miss-it", "The makers must use it, and the brief for the reader's vault."),
        ("the-vault-is-live", "The reading account carried between devices."),
        ("the-site-is-an-inbox", "Notes to the newsroom, carried by the vault."),
        ("the-passkey-opens-the-vault", "A passkey's PRF bytes compute a door; no server of ours."),
        ("where-the-vault-keys-live", "Where the keys live, and who holds what."),
    ]),
    ("How it is engineered", [
        ("explorer-to-villager-newsroom", "The brief for the move this repository is: go slow to go fast."),
        ("code-review-as-a-fractal-semantic-graph", "The review method: read a change at every layer."),
        ("if-somebody-built-a-company-on-code-review", "Why villager code is read line by line."),
        ("green-does-not-mean-live", "A release ends by asking the live site for its version."),
        ("how-to-run-synthetic-users", "Five readers who do not exist, a browser, and an afternoon."),
        ("brief-the-agent-too", "The people you talk to work with agents; brief their agents too."),
        ("two-agents-one-vault", "Two agents, one vault: how the newsroom's agents share state."),
    ]),
]


VERSIONS = json.loads((DATA / "versions.json").read_text(encoding="utf-8"))


def versions_page():
    vs = VERSIONS["versions"]
    if vs[0]["version"] != SITE_VERSION:
        sys.exit(f"site: site/data/versions.json's newest entry is {vs[0]['version']}; tools/version.json says {SITE_VERSION}: add the line for this version")
    parts = ["<h1>Versions</h1>\n<p class=\"lead\">Every change that lands on <code>dev</code> is a version, in small increments, and the deploy tags it. "
             f"This site is <b>{esc(SITE_VERSION)}</b>; the reader code it serves is release <b>{esc(RELEASE)}</b>, what the consuming sites pin. "
             "A version with a release of its own is a cut of the reader code; the others change the site, the tests or the tools and leave the served files as they were. "
             "<a href=\"../releases/\">The releases</a> have their manifests; <a href=\"../releases.json\">releases.json</a> and this page's <a href=\"versions.json\">versions.json</a> are the machine-readable forms.</p>\n"]
    rows = [[f"<a id=\"{esc(v['version'])}\" href=\"{GITHUB}/releases/tag/{esc(v['version'])}\"><code>{esc(v['version'])}</code></a>", esc(v["date"]),
             f"<a href=\"../releases/#{esc(v['release'])}\">{esc(v['release'])}</a>" + (" <span class=\"dim\">(cut)</span>" if v["release"] == v["version"] else ""), esc(v["line"])] for v in vs]
    parts.append(table(["Version", "Date", "Reader code", "What changed"], rows))
    md = "\n".join(f"- **{v['version']}** ({v['date']}, reader code {v['release']}): {v['line']}" for v in vs)
    return "\n".join(parts), md


class _Text(HTMLParser):
    """The text of a page body: the headings with their ids, and the paragraphs under each (skipping the agent block, code and tables' noise)."""
    BLOCK = {"p", "li", "blockquote", "dd", "dt", "td", "figcaption"}

    def __init__(self):
        super().__init__()
        self.headings, self.chunks, self.anchor, self.cur, self.skip, self.depth = [], [], "", [], 0, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("aside", "script", "style", "pre", "nav", "svg") or "agent" in (a.get("class") or ""):
            self.skip += 1
        if self.skip:
            return
        if tag in ("h2", "h3") and a.get("id"):
            self.anchor = a["id"]; self.cur = []; self.depth = 1
        elif tag in self.BLOCK:
            self.cur = []; self.depth = 1

    def handle_endtag(self, tag):
        if tag in ("aside", "script", "style", "pre", "nav", "svg"):
            self.skip = max(0, self.skip - 1); return
        if self.skip:
            return
        if tag in ("h2", "h3") and self.depth:
            t = " ".join("".join(self.cur).split())
            if t:
                self.headings.append([self.anchor, t])
            self.cur, self.depth = [], 0
        elif tag in self.BLOCK and self.depth:
            t = " ".join("".join(self.cur).split())
            if len(t) > 30:
                self.chunks.append([self.anchor, t[:900]])
            self.cur, self.depth = [], 0

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.cur.append(data)


def search_index(written_bodies):
    """search/docs.json and search/text.json in the format assets/search/search.js reads (the contract the newsroom's index also follows)."""
    docs, chunks = [], []
    for i, (rel, title, desc, body) in enumerate(written_bodies):
        if rel.startswith("search/"):
            continue
        t = _Text(); t.feed(body)
        kind = ("engineering" if rel.startswith(("review/", "releases/", "versions/", "agents/"))
                else "article" if rel.startswith("articles/") and rel != "articles/index.html" else "page")
        u = "" if rel == "index.html" else rel.replace("index.html", "")
        docs.append({"u": u or "index.html", "t": title, "k": kind, "x": desc, "h": t.headings, "i": len(docs)})
        for anchor, text in t.chunks:
            chunks.append([docs[-1]["i"], anchor, text])
    what = "The search index of api.newsroom.sgit.ai, built by site/build.py from the pages it writes; ranked in the browser by this API's own search component."
    return ({"v": 1, "site": HOST, "release": RELEASE, "version": SITE_VERSION, "docs": docs, "chunks": len(chunks), "what": what},
            {"v": 1, "release": RELEASE, "version": SITE_VERSION, "chunks": chunks})


def feed_xml():
    """RSS 2.0: one item per version (site/data/versions.json), newest first; a version that cut a release says so. The newsroom
    has a feed of its articles; a site that pins a release follows this one for the next."""
    def rfc822(d):
        import datetime
        return datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%a, %d %b %Y 00:00:00 +0000")
    items = []
    for m, _ in WRITTEN:
        items.append(f"<item><title>{esc(m['title'])}</title><link>{SITE}/articles/{m['slug']}.html</link><guid isPermaLink=\"true\">{SITE}/articles/{m['slug']}.html</guid>"
                     f"<pubDate>{rfc822(m['date'])}</pubDate><description>{esc(m['graph'].get('teaser') or m['summary'])}</description></item>")
    for v in VERSIONS["versions"]:
        cut = v["release"] == v["version"]
        title = f"{v['version']}: reader-code release" if cut else f"{v['version']}"
        link = f"{SITE}/releases/#{v['release']}" if cut else f"{SITE}/versions/#{v['version']}"
        items.append(f"<item><title>{esc(title)}</title><link>{link}</link><guid isPermaLink=\"false\">{SITE}/versions/{esc(v['version'])}</guid>"
                     f"<pubDate>{rfc822(v['date'])}</pubDate><description>{esc(v['line'])}</description></item>")
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>'
            f'<title>SGit Newsroom API: versions and releases</title><link>{SITE}/versions/</link>'
            f'<atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml"/>'
            f'<description>Every version of the reader code\'s repository that landed, and the releases a site pins. {SITE}</description>'
            f'<language>en</language><lastBuildDate>{rfc822(VERSION["date"])}</lastBuildDate>' + "".join(items) + "</channel></rss>\n")


def written_articles():
    """The articles written here: site/content/articles/<slug>.md in the newsroom's article format (front matter, !shot figures,
    {#anchor} headings), with graphs/<slug>.json beside them. Newest first."""
    out = []
    for p in sorted(CONTENT.glob("*.md")):
        if p.name == "README.md":
            continue
        meta, body = front_matter(p.read_text(encoding="utf-8"))
        meta["slug"] = p.stem
        g = CONTENT / "graphs" / f"{p.stem}.json"
        meta["graph"] = json.loads(g.read_text(encoding="utf-8")) if g.exists() else {}
        out.append((meta, body))
    return sorted(out, key=lambda x: x[0].get("date", ""), reverse=True)


WRITTEN = written_articles()


def render_article(meta, body):
    """One article: the header (crumb, eyebrow, title, byline, abstract), then the body with its figures. Returns (html, markdown)."""
    from PIL import Image
    html_parts, md_parts, chunk = [], [], []

    def flush():
        if chunk:
            h = render("\n".join(chunk))
            h = re.sub(r'<h(\d) id="[^"]*">(.*?) \{#([a-z0-9-]+)\}</h\1>', r'<h\1 id="\3">\2</h\1>', h)
            html_parts.append(h)
            md_parts.append("\n".join(chunk))
            chunk.clear()
    for line in body.splitlines():
        m = re.match(r"^!shot\s+([\w.-]+)\s*\|\s*images/\s*\|\s*(.*?)\s*\|\s*(\w+)\s*$", line)
        if not m:
            chunk.append(line); continue
        flush()
        f, cap, kind = m.groups()
        w, h = Image.open(CONTENT / "images" / f).size
        html_parts.append(f'<figure class="shot" data-kind="{esc(kind)}"><a href="images/{esc(f)}"><img src="images/{esc(f)}" alt="{esc(cap)}" width="{w}" height="{h}" loading="lazy"></a>'
                          f'<figcaption>{esc(cap)}</figcaption></figure>')
        md_parts.append(f"![{cap}](images/{f})\n\n*{cap}*")
    flush()
    author = f'<a href="{esc(meta["author_url"])}">{esc(meta["author"])}</a>'
    head = (f'<h1>{esc(meta["title"])}</h1>\n'
            f'<p class="byline">By {author} · {esc(meta["date"])} · published with <a href="../versions/#{esc(meta["version"])}">{esc(meta["version"])}</a> · '
            f'<a href="{esc(meta.get("license", ""))}">CC BY 4.0</a> · the editorial responsibility is the owner\'s, Dinis Cruz</p>\n'
            f'<p class="abstract">{esc(meta["summary"])}</p>\n')
    body_html = expand("\n".join(html_parts), f"articles/{meta['slug']}.html")
    md = (f"By {meta['author']} <{meta['author_url']}>, {meta['date']}, published with {meta['version']}.\n\n> {meta['summary']}\n\n" + "\n\n".join(md_parts))
    return head + '<div class="article">' + body_html + "</div>", md


def articles_page():
    parts = ["<h1>The articles behind it</h1>\n<p class=\"lead\">Everything here was designed in public first, as an article on <a href=\"https://newsroom.sgit.ai/\">newsroom.sgit.ai</a>, "
             "then built, then written about again when it went live. Read them in this order and you have the case, the design and the engineering; each is numbered, so a "
             "<a href=\"https://newsroom.sgit.ai/for/\">reading list in a link</a> can carry a set of them to a colleague.</p>\n"]
    md = []
    if WRITTEN:
        cards = "".join(f'<a class="card article written" href="{esc(m["slug"])}.html"><span class="tag">{esc(m["date"])} · by {esc(m["author"])}</span>'
                        f'<h3>{esc(m["title"].split(": ")[0])}</h3><p>{esc(m["graph"].get("teaser") or m["title"])}</p></a>' for m, _ in WRITTEN)
        parts.append(f"<h2>Written here</h2>\n<p>Articles about this API, written on this site in the newsroom's format and voice by the agent that did the work.</p>\n<div class=\"cards\">{cards}</div>\n")
        md.append("## Written here\n")
        md += [f"- [{m['title']}]({SITE}/articles/{m['slug']}.html) ({m['date']}, by {m['author']})" for m, _ in WRITTEN]
        md.append("")
    for group, items in CURATED:
        cards = []
        md.append(f"## {group}\n")
        for slug, why in items:
            a = article(slug)
            if not a:
                continue
            cards.append(article_card(a, why=esc(why)))
            md.append(f"- [{a['title']}]({a['url']}) ({a['date']}, No. {a.get('n', '')}): {why}")
        if cards:
            nums = ",".join(str(article(s)["n"]) for s, _ in items if article(s) and article(s).get("n"))
            parts.append(f"<h2>{esc(group)}</h2>\n<div class=\"cards\">{''.join(cards)}</div>\n"
                         f'<p class="dim">Send this set: <a href="{NEWSROOM}/for/make.html#r={nums}">make a reading list of these {len(cards)}</a>.</p>\n')
    parts.append(f'<p>Every article on newsroom.sgit.ai, with its graph: <a href="{NEWSROOM}/articles/">the articles</a>, <a href="{NEWSROOM}/articles/graphs.json">graphs.json</a>.</p>')
    return "\n".join(parts), "\n".join(md)


# ------------------------------------------------------------------------------------------------------------ build
def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build(out):
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    assets = ROOT / "site/assets"
    shutil.copytree(assets, out / "assets")
    # the data the review and the proof pages link to is published with them: map/before/<newsroom release>/ and map/proof/
    for d in ("map/before", "map/proof"):
        shutil.copytree(ROOT / d, out / d)
    shutil.copytree(ROOT / "site/og", out / "og")      # the link-preview cards, drawn by site/og.py and committed
    if (CONTENT / "images").exists():
        shutil.copytree(CONTENT / "images", out / "articles/images")   # the figures of the articles written here
    written = []     # (rel, title, description, md_text)

    def emit(rel, meta, body_html, md_body):
        md_rel = rel[:-5] + ".md"
        write(out / rel, page_html(rel, meta, body_html, md_twin=Path(md_rel).name))
        write(out / md_rel, page_md(rel, meta, md_body))
        written.append((rel, meta["title"], meta.get("description", ""), md_body))

    # pages: markdown rendered, or an .html fragment used as it is (both with front matter; the .md twin of a fragment is its text)
    for p in sorted(list(PAGES.rglob("*.md")) + list(PAGES.rglob("*.html"))):
        meta, body = front_matter(p.read_text(encoding="utf-8"))
        rel = p.relative_to(PAGES).with_suffix(".html").as_posix()
        if p.suffix == ".md":
            html_body, md_body = expand(render(body), rel), body
        else:
            html_body, md_body = expand(body, rel), meta.get("markdown", strip_tags(body))
        emit(rel, meta, html_body, md_body)

    # data pages
    for rel, meta, fn in [
        ("docs/contracts/index.html", {"title": "The contracts", "section": "Docs", "crumbs": [("Docs", "docs/")], "eyebrow": "Reference",
                                       "description": "The fourteen contracts other sites, pages and agents program against: the meter config, a charged page, persona links, the reading-list link, article numbers, the return page, the export, the share, the envelope, the contact file, the wire's vault, events, a component, the import's rules."}, contracts_page),
        ("docs/state/index.html", {"title": "State, inputs and outputs", "section": "Docs", "crumbs": [("Docs", "docs/")], "eyebrow": "Reference",
                                   "description": "Where a reader's data lives (localStorage on the page's origin), everything that comes in, and every channel by which anything leaves the browser."}, state_page),
        ("review/index.html", {"title": "The map, and the review", "section": "Review", "eyebrow": "Phase 0 and phase 3 of the move", "wide": True,
                               "description": "Everything a reader runs on newsroom.sgit.ai, mapped before the move and reviewed line by line: the numbers, the eighteen findings as issues, the accepted gaps."}, review_page),
        ("review/map/index.html", {"title": "The map as a graph", "section": "Review", "crumbs": [("Review", "review/")], "wide": True,
                                   "description": "The map of the reader code as a layered graph: the site, the pages, the views, the files, the contracts and the findings anchored to them."}, map_page),
        ("review/proof/index.html", {"title": "The proof of the move", "section": "Review", "crumbs": [("Review", "review/")],
                                     "description": "The live site serves the same bytes before and after the move, by hash: every file, the frozen copies, and every page once normalised."}, proof_page),
        ("versions/index.html", {"title": "Versions", "section": "Releases", "crumbs": [("Releases", "releases/")], "description": "Every version of this repository that landed on dev, newest first, with the reader-code release each one serves and what changed, in a line."}, versions_page),
        ("releases/index.html", {"title": "Releases", "section": "Releases", "description": "Every release of the reader code served from api.newsroom.sgit.ai, its date, its notes, its manifest of paths and hashes, and the files that differ from the newsroom's bytes and why."}, releases_page),
        ("articles/index.html", {"title": "The articles behind it", "section": "Articles", "description": "The newsroom.sgit.ai articles that designed, built and reviewed this API, curated for publishers, for the reader's own newsroom, and for the engineering."}, articles_page),
    ]:
        body_html, md_body = fn()
        emit(rel, meta, body_html, md_body)

    # the articles written here (site/content/articles/), each with its graph published beside it
    for m, body in WRITTEN:
        rel = f"articles/{m['slug']}.html"
        html_body, md_body = render_article(m, body)
        when = __import__("datetime").date.fromisoformat(m["date"]).strftime("%-d %B %Y")
        emit(rel, {"title": m["title"], "description": m["graph"].get("teaser") or m["summary"][:300], "section": "Articles", "crumbs": [("Articles", "articles/")],
                   "crumb_title": m["title"].split(": ")[0], "eyebrow": f"Article · {when} · by {m['author']}", "date": m["date"], "ld_type": "Article",
                   "ld_author": {"@type": "Organization", "name": f"{m['author']}, an agent of the SGit Newsroom", "url": m["author_url"]},
                   "agent": f"An article on api.newsroom.sgit.ai by {m['author']}, the agent that did the work, in the newsroom's article format: {m['graph'].get('core_idea', m['summary'])} "
                            f"Its graph: {SITE}/articles/graphs/{m['slug']}.json."}, html_body, md_body)
        if m["graph"]:
            write(out / "articles/graphs" / f"{m['slug']}.json", json.dumps(m["graph"], indent=1, ensure_ascii=False) + "\n")

    # machine-readable
    write(out / "review/map/graph.json", json.dumps(map_graph_json(), indent=1, ensure_ascii=False) + "\n")
    write(out / "versions/versions.json", json.dumps(VERSIONS, indent=1, ensure_ascii=False) + "\n")
    rels = [{"release": m["release"], "date": m["date"], "files": m["counts"]["files"], "bytes": m["counts"]["bytes"], "manifest": f"{SITE}/{m['release']}/manifest.json"} for m in MANIFESTS]
    write(out / "releases.json", json.dumps({"what": "The releases of the newsroom's reader code served from this host. A consuming site pins one; nothing here is edited after it is published.",
                                             "host": SITE, "current": RELEASE, "version": SITE_VERSION, "releases": rels}, indent=1) + "\n")
    # llms.txt, llms-full.txt, sitemap
    lines = [f"# SGit Newsroom API ({HOST})", "", f"> A client-side API for a newsroom: the reading meter, the reader's personas, reading lists in a link, subscribe and the encrypted share, "
             f"the reader's vault, search, the wire reader. Components, formats and contracts the browser runs, with no server and nothing to deploy but files, served at {SITE}/<release>/<path>. "
             f"Current release: {RELEASE}. Source: {GITHUB}. The live example: {NEWSROOM}/.", "", f"Site version: {SITE_VERSION} (reader-code release {RELEASE})", "", "## Pages", ""]
    for rel, title, desc, _ in written:
        url = SITE + "/" + ("" if rel == "index.html" else rel.replace("index.html", ""))
        lines.append(f"- [{title}]({url}): {desc}")
    lines += ["", "## Data", "", f"- [{RELEASE}/manifest.json]({SITE}/{RELEASE}/manifest.json): every served path with its bytes and SHA-256",
              f"- [releases.json]({SITE}/releases.json): every release", f"- [feed.xml]({SITE}/feed.xml): versions and releases, as RSS",
              f"- [search/docs.json]({SITE}/search/docs.json) and [search/text.json]({SITE}/search/text.json): the search index, one entry per page and the text in paragraphs", f"- [review/map/graph.json]({SITE}/review/map/graph.json): the map as a graph",
              f"- [the newsroom's articles/ids.json]({NEWSROOM}/articles/ids.json): the article-number contract", f"- [the newsroom's articles/graphs.json]({NEWSROOM}/articles/graphs.json): the article feed"]
    write(out / "llms.txt", "\n".join(lines) + "\n")
    full = [f"# SGit Newsroom API: the whole site in one fetch", "", f"Generated with the site at {SITE_VERSION} (reader-code release {RELEASE}). Each section is a page; its address is given first.", ""]
    for rel, title, desc, md_body in written:
        url = SITE + "/" + ("" if rel == "index.html" else rel.replace("index.html", ""))
        full += [f"\n\n---\n\n# {title}\n\n<{url}>\n\n> {desc}\n", md_body]
    write(out / "llms-full.txt", "\n".join(full) + "\n")
    today = VERSION["date"]
    urls = "".join(f"<url><loc>{SITE}/{'' if rel == 'index.html' else rel.replace('index.html', '')}</loc><lastmod>{today}</lastmod></url>" for rel, *_ in written)
    write(out / "sitemap.xml", f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n')
    write(out / "robots.txt", f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    write(out / "feed.xml", feed_xml())
    docs_json, text_json = search_index([(rel, title, desc, (out / rel).read_text(encoding="utf-8")) for rel, title, desc, _ in written])
    write(out / "search/docs.json", json.dumps(docs_json, ensure_ascii=False) + "\n")
    write(out / "search/text.json", json.dumps(text_json, ensure_ascii=False) + "\n")
    write(out / ".nojekyll", "")
    return written


def strip_tags(fragment):
    """A readable markdown-ish twin of an HTML fragment: headings and links kept, tags dropped."""
    s = re.sub(r"<h([1-4])[^>]*>(.*?)</h\1>", lambda m: "\n" + "#" * int(m.group(1)) + " " + m.group(2) + "\n", fragment, flags=re.S)
    s = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', lambda m: f"[{m.group(2)}]({m.group(1)})", s, flags=re.S)
    s = re.sub(r"<li[^>]*>", "- ", s); s = re.sub(r"</(p|li|div|section|tr)>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = htmlmod.unescape(s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def heading_ids(html_text):
    """An h2 or h3 without an id gets one from its text (as md.py gives markdown headings), so search can link to the section."""
    seen = set()
    def put(m):
        tag, attrs, inner = m.group(1), m.group(2), m.group(3)
        if "id=" in attrs:
            return m.group(0)
        base = re.sub(r"[^a-z0-9]+", "-", strip_tags(inner).lower()).strip("-") or "section"
        i, n = base, 2
        while i in seen:
            i, n = f"{base}-{n}", n + 1
        seen.add(i)
        return f"<{tag} id=\"{i}\"{attrs}>{inner}</{tag}>"
    return re.sub(r"<(h[23])([^>]*)>(.*?)</\1>", put, html_text, flags=re.S)


def expand(html_text, rel):
    """Small directives a markdown page can use: {{live: text}}, {{code lang\\n...}} handled as fenced code by md; {{cards}} blocks are plain HTML in the page."""
    up = "../" * rel.count("/")
    html_text = heading_ids(html_text)
    html_text = html_text.replace("{{release}}", esc(RELEASE)).replace("{{version}}", esc(SITE_VERSION)).replace("{{newsroom}}", NEWSROOM).replace("{{github}}", GITHUB).replace("{{newsroom_github}}", NEWSROOM_GITHUB).replace("{{site}}", SITE).replace("{{up}}", up)
    html_text = html_text.replace("{{files}}", str(MANIFESTS[-1]["counts"]["files"])).replace("{{bytes}}", f"{MANIFESTS[-1]['counts']['bytes']:,}")
    html_text = html_text.replace("{{reader_lines}}", f"{MAP['counts']['reader_code_lines']:,}").replace("{{tests}}", str(MAP["counts"]["tests"])).replace("{{findings}}", str(MAP["counts"]["findings"]))
    html_text = html_text.replace("{{contracts}}", str(MAP["counts"]["contracts"])).replace("{{controls}}", str(MAP["counts"]["controls"])).replace("{{articles}}", str(len(ARTICLES["articles"])))
    # <p>{{live: ...}}</p> → a live callout
    html_text = re.sub(r"(?:<p>)?\{\{live: (.*?)\}\}(?:</p>)?", lambda m: live(m.group(1)), html_text, flags=re.S)
    # <pre><code class="language-x">…</code></pre> → a copyable block
    def pre(m):
        lang = m.group(1) or ""
        return f'<pre class="code" data-lang="{esc(lang)}"><button class="copy" type="button" aria-label="Copy">Copy</button><code>{m.group(2)}</code></pre>'
    html_text = re.sub(r'<pre><code(?: class="(?:language-|lang-)([^"]*)")?>([\s\S]*?)</code></pre>', pre, html_text)
    return html_text


def refresh_articles(newsroom):
    g = json.loads((Path(newsroom) / "articles/graphs.json").read_text(encoding="utf-8"))
    ids = json.loads((Path(newsroom) / "articles/ids.json").read_text(encoding="utf-8"))
    n_of = {e["slug"]: e["n"] for e in ids.get("articles", [])}
    arts = [{"slug": a["slug"], "n": n_of.get(a["slug"]), "title": a["title"], "date": a["date"], "url": a["url"], "markdown": a.get("markdown", ""),
             "card": a.get("card", ""), "teaser": a.get("teaser", ""), "topics": a.get("topics", []), "tags": a.get("tags", [])} for a in g["articles"]]
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "articles.json").write_text(json.dumps({"what": "The newsroom's article feed (articles/graphs.json) with each article's number (articles/ids.json), copied by site/build.py --refresh-articles so this site can link and curate them. Refresh it with the newsroom.",
                                                      "newsroom_release": g.get("site_version", ""), "articles": arts}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"site: {len(arts)} articles copied from {newsroom}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--refresh-articles", metavar="NEWSROOM", help="a newsroom checkout to copy the article feed from")
    ap.add_argument("--check", action="store_true", help="build into a temporary directory and fail if www/ differs")
    a = ap.parse_args()
    if a.refresh_articles:
        refresh_articles(a.refresh_articles)
        global ARTICLES
        ARTICLES = json.loads((DATA / "articles.json").read_text(encoding="utf-8"))
    if a.check:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "www"
            build(tmp)
            diff = []
            for p in sorted(tmp.rglob("*")):
                if p.is_file():
                    q = OUT / p.relative_to(tmp)
                    if not q.exists() or q.read_bytes() != p.read_bytes():
                        diff.append(p.relative_to(tmp).as_posix())
            for q in sorted(OUT.rglob("*")):
                if q.is_file() and not (tmp / q.relative_to(OUT)).exists():
                    diff.append(q.relative_to(OUT).as_posix() + " (stale)")
            if diff:
                print(f"site: www/ is not what site/build.py writes ({len(diff)} file(s)); run it and commit")
                for d in diff[:20]:
                    print("  ✗ " + d)
                sys.exit(1)
            print("site: www/ is up to date")
            return
    written = build(OUT)
    print(f"site: {len(written)} pages written to www/ ({SITE_VERSION}, reader code {RELEASE})")


if __name__ == "__main__":
    main()
