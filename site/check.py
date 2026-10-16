#!/usr/bin/env python3
"""The website's gate: www/ (written by site/build.py) holds together, before it is published.

    python3 site/check.py            # exit 1 with every failure listed

The newsroom's admin/build/validate.js is the model (its checks 2 to 7 and 5b, for the pages this site has):
  1. every page has a title, a description, a canonical on the host with og:url equal to it, data-root on <html>, the chrome
     (the brand in the bar, the version chip, the theme picker, the fine line in the footer), the block for agents, and a
     markdown twin that exists
  2. every relative href, src and data-src resolves to a file in www/ (a directory resolves to its index.html); a link into
     the host (https://api.newsroom.sgit.ai/...) resolves to a file in www/ or, under /vX.Y.Z/, to a file of that release
  3. <div> and </div> balance on every page
  4. sitemap.xml lists every page and nothing that is not a page; llms.txt names every page's address; llms-full.txt carries
     every page's title; robots.txt points at the sitemap; feed.xml is well formed and carries this version; search/docs.json and text.json index every page
  5. releases.json names the reader-code release and the site's version as tools/version.json does
  6. the key-leak tripwire: nothing shaped like a vault key, a Stripe secret or a cloud key anywhere in www/
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "www"
VERSION = json.loads((ROOT / "tools/version.json").read_text(encoding="utf-8"))
HOST = "https://api.newsroom.sgit.ai"
SKIP_HOSTS = ("http://", "https://", "mailto:", "data:", "javascript:")


class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.divs = [], 0
        self.meta, self.links = {}, {}
        self.classes = set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div":
            self.divs += 1
        for k in ("href", "src", "data-src"):
            if a.get(k):
                self.refs.append(a[k])
        if tag == "meta":
            self.meta[a.get("property") or a.get("name") or ""] = a.get("content", "")
        if tag == "link" and a.get("rel"):
            self.links.setdefault(a["rel"], []).append(a.get("href", ""))
        if a.get("class"):
            self.classes.update(a["class"].split())
        if tag == "html" and "data-root" in a:
            self.classes.add("__data-root")

    def handle_endtag(self, tag):
        if tag == "div":
            self.divs -= 1


def resolve(page, ref):
    """A reference on a page, as the path under www/ it names (None for one this gate does not follow)."""
    ref = ref.split("#", 1)[0].split("?", 1)[0]
    if not ref:
        return None
    if ref.startswith(HOST + "/"):
        ref = "/" + ref[len(HOST) + 1:]
    if ref.startswith(SKIP_HOSTS) or ref.startswith("//"):
        return None
    if ref.startswith("/"):
        target = ref[1:]
        if target.endswith("/") or target == "":
            target += "index.html"
    else:
        target = (Path(page).parent / ref).as_posix() if ref else page
        target = re.sub(r"^(\./)+", "", target)
        parts = []
        for part in target.split("/"):
            if part == "..":
                if parts:
                    parts.pop()
            elif part not in ("", "."):
                parts.append(part)
        target = "/".join(parts)
        if ref.endswith("/"):
            target += "/"
    if target.endswith("/") or target == "":
        target += "index.html"
    m = re.match(r"(v\d+\.\d+\.\d+)/(.+)", target)       # a release's file: beside www/ on the host (tools/release.py site)
    if m:
        return ("release", m.group(1), m.group(2))
    return ("www", target)


def main():
    errors = []
    if not WWW.exists():
        sys.exit("site: www/ does not exist; run site/build.py")
    pages = sorted(p.relative_to(WWW).as_posix() for p in WWW.rglob("*.html"))
    files = {p.relative_to(WWW).as_posix() for p in WWW.rglob("*") if p.is_file()}
    release_files = {d.name: {f["path"] for f in json.loads((d / "manifest.json").read_text(encoding="utf-8"))["files"]} | {"manifest.json"}
                     for d in (ROOT / "releases").glob("v*")}
    titles = {}
    for rel in pages:
        text = (WWW / rel).read_text(encoding="utf-8")
        p = Refs(); p.feed(text)
        url = HOST + "/" + ("" if rel == "index.html" else rel.replace("index.html", ""))
        m = re.search(r"<title>([^<]*)</title>", text)
        titles[rel] = html.unescape(m.group(1)) if m else ""
        # 1. the page
        if not m or not m.group(1).strip():
            errors.append(f"{rel}: no <title>")
        if not p.meta.get("description"):
            errors.append(f"{rel}: no description")
        canon = (p.links.get("canonical") or [""])[0]
        if canon != url:
            errors.append(f"{rel}: canonical is {canon!r}, the page's address is {url}")
        if p.meta.get("og:url") != canon:
            errors.append(f"{rel}: og:url {p.meta.get('og:url')!r} is not the canonical")
        if "__data-root" not in p.classes:
            errors.append(f"{rel}: <html> has no data-root")
        for cls, what in (("brand", "the brand in the bar"), ("ver", "the version chip"), ("theme-pick", "the theme picker"), ("brandline", "the footer's brand line"),
                          ("netline", "the footer's network line"), ("partnote", "the participant disclosure"), ("verline", "the footer's version line"), ("agent", "the block for agents"), ("skip", "the skip link")):
            if cls not in p.classes:
                errors.append(f"{rel}: the chrome is missing {what} (class {cls})")
        twins = p.links.get("alternate") or []
        if not twins:
            errors.append(f"{rel}: no markdown twin declared")
        og = p.meta.get("og:image", "")
        if not og.startswith(HOST + "/og/") or not (WWW / og[len(HOST) + 1:]).exists():
            errors.append(f"{rel}: og:image {og!r} is not a card under www/og/ (python3 site/og.py draws one)")
        if p.meta.get("og:image:width") != "1200" or p.meta.get("og:image:height") != "630" or p.meta.get("twitter:card") != "summary_large_image":
            errors.append(f"{rel}: the card's size or the Twitter card type is not declared")
        # 2. the references
        for ref in p.refs:
            r = resolve(rel, ref)
            if r is None:
                continue
            if r[0] == "release":
                if r[1] not in release_files:
                    errors.append(f"{rel}: {ref} names a release that does not exist")
                elif r[2] not in release_files[r[1]]:
                    errors.append(f"{rel}: {ref} is not a file of release {r[1]}")
            elif r[1] not in files:
                errors.append(f"{rel}: {ref} does not resolve (looked for www/{r[1]})")
        # 3. divs
        if p.divs != 0:
            errors.append(f"{rel}: <div> and </div> do not balance ({p.divs:+d})")
    # 4. the site-wide files
    sitemap = (WWW / "sitemap.xml").read_text(encoding="utf-8") if (WWW / "sitemap.xml").exists() else ""
    locs = set(re.findall(r"<loc>([^<]+)</loc>", sitemap))
    want = {HOST + "/" + ("" if rel == "index.html" else rel.replace("index.html", "")) for rel in pages}
    for u in sorted(want - locs):
        errors.append(f"sitemap.xml: {u} is a page and is not listed")
    for u in sorted(locs - want):
        errors.append(f"sitemap.xml: {u} is listed and is not a page")
    llms = (WWW / "llms.txt").read_text(encoding="utf-8") if (WWW / "llms.txt").exists() else ""
    for u in sorted(want):
        if u not in llms:
            errors.append(f"llms.txt: does not name {u}")
    if f"Site version: {VERSION['version']}" not in llms:
        errors.append(f"llms.txt: does not carry 'Site version: {VERSION['version']}'")
    full = (WWW / "llms-full.txt").read_text(encoding="utf-8") if (WWW / "llms-full.txt").exists() else ""
    for rel, t in titles.items():
        name = t.split(" · ")[0]
        if name and f"# {name}" not in full:
            errors.append(f"llms-full.txt: does not carry the page {rel} ({name})")
    robots = (WWW / "robots.txt").read_text(encoding="utf-8") if (WWW / "robots.txt").exists() else ""
    if f"Sitemap: {HOST}/sitemap.xml" not in robots:
        errors.append("robots.txt: does not point at the sitemap")
    # 4b. the feed: well-formed, and its newest item is this version
    try:
        import xml.etree.ElementTree as ET
        feed = ET.parse(WWW / "feed.xml").getroot()
        titles_ = [t.text or "" for t in feed.findall("channel/item/title")]
        if not any(t.startswith(VERSION["version"]) for t in titles_):
            errors.append(f"feed.xml: no item for {VERSION['version']}")
    except (OSError, ET.ParseError) as e:
        errors.append(f"feed.xml: {e}")
    # 4c. the search index: one entry per page but the search page itself, in the component's format
    try:
        dj = json.loads((WWW / "search/docs.json").read_text(encoding="utf-8")); tj = json.loads((WWW / "search/text.json").read_text(encoding="utf-8"))
        if dj.get("v") != 1 or len(dj.get("docs", [])) != len(pages) - 1 or dj.get("chunks") != len(tj.get("chunks", [])) or dj.get("release") != VERSION["release"]:
            errors.append(f"search/docs.json: {len(dj.get('docs', []))} docs for {len(pages) - 1} pages, {dj.get('chunks')} chunks declared against {len(tj.get('chunks', []))}, release {dj.get('release')}")
    except (OSError, ValueError) as e:
        errors.append(f"search index: {e}")
    # 5. releases.json
    try:
        rj = json.loads((WWW / "releases.json").read_text(encoding="utf-8"))
        if rj.get("current") != VERSION["release"] or rj.get("version") != VERSION["version"]:
            errors.append(f"releases.json: current {rj.get('current')} / version {rj.get('version')}; tools/version.json says {VERSION['release']} / {VERSION['version']}")
    except (OSError, ValueError) as e:
        errors.append(f"releases.json: {e}")
    # 6. the tripwire
    KEYS = [(re.compile(r"\bsk_(?:live|test)_[0-9A-Za-z]{16,}"), "a Stripe secret key"), (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key"),
            (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"), "a private key"),
            (re.compile(r"\bgh[pousr]_[0-9A-Za-z]{30,}"), "a GitHub token"), (re.compile(r"\"(?:private|secret|signing)_?key\"\s*:\s*\"[A-Za-z0-9+/=_-]{32,}\""), "a key in JSON")]
    for rel in sorted(files):
        if rel.endswith((".html", ".md", ".txt", ".json", ".js", ".css", ".xml", ".svg")):
            text = (WWW / rel).read_text(encoding="utf-8", errors="replace")
            for rx, what in KEYS:
                if rx.search(text):
                    errors.append(f"{rel}: looks like it carries {what}")
    if errors:
        print(f"site check: {len(errors)} error(s) across {len(pages)} pages")
        for e in errors:
            print("  ✗ " + e)
        sys.exit(1)
    print(f"site check: OK: {len(pages)} pages, {len(files)} files; every reference resolves, the sitemap, llms.txt and llms-full.txt agree with the tree, no key shapes")


if __name__ == "__main__":
    main()
