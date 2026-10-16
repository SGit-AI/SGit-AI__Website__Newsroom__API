#!/usr/bin/env python3
"""Link-preview cards: one 1200x630 JPEG per page, for og:image and the Twitter card (the newsroom has one per article).

    python3 site/og.py            # a card for every page in www/ that has none in site/og/
    python3 site/og.py --all      # redraw every card

Drawn with Pillow from the page's title, eyebrow and description as site/build.py wrote them into www/, in Newsprint's colours,
and committed under site/og/ (build.py copies them to www/og/). They are drawn here and committed, not drawn by the build: a
font library renders a few pixels differently from one machine to the next, and the build must be the same bytes twice.
site/check.py fails a page whose card is missing, so a new page gets its card before it is published.
"""
import argparse
import html
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WWW, OUT = ROOT / "www", ROOT / "site/og"
FONTS = Path("/usr/share/fonts/truetype/dejavu")
W, H = 1200, 630
# Newsprint's tokens (site/assets/themes.css): the card is the page in its default theme
BG, PANEL, LINE, HEAD, TEXT, DIM, ACCENT, ACCENT_DK = "#faf9f5", "#ffffff", "#e5e1d5", "#101114", "#34363c", "#5c5f66", "#0f766e", "#115e59"


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def slug_of(rel):
    return "home" if rel == "index.html" else rel.replace("/index.html", "").removesuffix(".html").replace("/", "-")


def card(title, eyebrow, description, out):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 14, H], fill=ACCENT)                                   # the accent rule, as a story's lead has
    d.rectangle([60, 56, W - 60, 57], fill=LINE)
    mono = font("DejaVuSansMono.ttf", 28)
    d.text((60, 70), "api", font=mono, fill=HEAD)
    d.text((60 + d.textlength("api", font=mono), 70), ".newsroom.sgit.ai", font=mono, fill=DIM)
    if eyebrow:
        d.text((60, 150), eyebrow.upper(), font=font("DejaVuSans.ttf", 22), fill=ACCENT_DK, spacing=4)
    size = 66
    while True:
        tf = font("DejaVuSerif-Bold.ttf", size)
        lines = wrap(d, title, tf, W - 140)
        if len(lines) <= 3 or size <= 40:
            break
        size -= 4
    y = 200
    for ln in lines[:3]:
        d.text((60, y), ln, font=tf, fill=HEAD)
        y += int(size * 1.2)
    desc_font = font("DejaVuSans.ttf", 26)
    dl = wrap(d, description, desc_font, W - 140)[:3]
    y = max(y + 22, 410)
    for ln in dl:
        if y > 540:
            break
        d.text((60, y), ln, font=desc_font, fill=TEXT)
        y += 36
    d.rectangle([60, H - 62, W - 60, H - 61], fill=LINE)
    small = font("DejaVuSans.ttf", 20)
    d.text((60, H - 48), "A client-side API for a newsroom: components, formats and contracts the browser runs. No server. Apache 2.0.", font=small, fill=DIM)
    im.save(out, "JPEG", quality=86, optimize=True, progressive=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--all", action="store_true", help="redraw every card")
    a = ap.parse_args()
    if not WWW.exists():
        sys.exit("og: www/ does not exist; run site/build.py first")
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for p in sorted(WWW.rglob("*.html")):
        rel = p.relative_to(WWW).as_posix()
        out = OUT / f"{slug_of(rel)}.jpg"
        if out.exists() and not a.all:
            continue
        t = p.read_text(encoding="utf-8")
        title = html.unescape(re.search(r"<title>([^<]*)</title>", t).group(1).split(" · ")[0])
        if len(title.split()) > 14:          # an article's title is a hook, a colon and the argument: the card carries the hook
            title = title.split(": ")[0]
        desc = html.unescape((re.search(r'<meta name="description" content="([^"]*)"', t) or [None, ""])[1])
        eyebrow = html.unescape((re.search(r'<p class="eyebrow">([^<]*)</p>', t) or [None, ""])[1])
        card(title, eyebrow, desc, out)
        n += 1
    print(f"og: {n} card(s) drawn into site/og/ ({len(list(OUT.glob('*.jpg')))} in all)")


if __name__ == "__main__":
    main()
