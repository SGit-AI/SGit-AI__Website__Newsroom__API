#!/usr/bin/env python3
"""A small Markdown renderer for the pages this site builds from its own notes and issues.

    from md import render, front_matter
    meta, body = front_matter(text)      # YAML-ish front matter: key: value, and key: [a, b] lists
    html = render(body)

Covers what the engineering files use and nothing more: headings, paragraphs, bullet and numbered lists, fenced
code (with the language as a class), inline code, bold, italic, links, images, tables, block quotes and rules.
Everything is escaped first; only the markup this file makes survives, so a note cannot carry HTML into a page.
"""
import html
import re

_INLINE = [
    (re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)"), lambda m: f'<img src="{m.group(2)}" alt="{m.group(1)}" loading="lazy">'),
    (re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)"), lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>'),
    (re.compile(r"`([^`]+)`"), lambda m: f"<code>{m.group(1)}</code>"),
    (re.compile(r"\*\*([^*]+)\*\*"), lambda m: f"<b>{m.group(1)}</b>"),
    (re.compile(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])"), lambda m: f"<i>{m.group(1)}</i>"),
]


def front_matter(text):
    """Split `---\\nkey: value\\n---` off the top. Values: strings, or [a, b] lists. Returns (meta, body)."""
    meta = {}
    if not text.startswith("---"):
        return meta, text
    end = text.find("\n---", 3)
    if end < 0:
        return meta, text
    for line in text[3:end].strip().splitlines():
        if ":" not in line or line.startswith("#"):
            continue
        k, v = line.split(":", 1)
        v = v.split("  #")[0].strip()
        if v.startswith("[") and v.endswith("]"):
            meta[k.strip()] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
        else:
            meta[k.strip()] = v.strip("'\"")
    return meta, text[end + 4:].lstrip("\n")


def inline(s):
    s = html.escape(s, quote=False)
    for rx, fn in _INLINE:
        s = rx.sub(fn, s)
    return s


def render(text):
    out, para, lst, code, table, quote = [], [], None, None, None, []

    def flush_para():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()

    def flush_list():
        nonlocal lst
        if lst:
            tag, items = lst
            out.append(f"<{tag}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{tag}>")
            lst = None

    def flush_table():
        nonlocal table
        if table:
            head, rows = table[0], table[1:]
            out.append('<div class="tablewrap"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table></div>")
            table = None

    def flush_quote():
        if quote:
            out.append("<blockquote>" + inline(" ".join(quote)) + "</blockquote>")
            quote.clear()

    def flush_all():
        flush_para(); flush_list(); flush_table(); flush_quote()

    for raw in text.splitlines():
        line = raw.rstrip()
        if code is not None:
            if line.startswith("```"):
                lang, lines = code
                out.append(f'<pre><code class="lang-{html.escape(lang)}">' + html.escape("\n".join(lines)) + "</code></pre>")
                code = None
            else:
                code[1].append(raw)
            continue
        if line.startswith("```"):
            flush_all(); code = (line[3:].strip() or "text", [])
            continue
        if not line.strip():
            flush_all()
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush_all(); n = len(m.group(1))
            text_ = m.group(2).strip()
            slug = re.sub(r"[^a-z0-9]+", "-", text_.lower()).strip("-")[:60]
            out.append(f'<h{n} id="{slug}">{inline(text_)}</h{n}>')
            continue
        if re.match(r"^(-{3,}|\*{3,})$", line):
            flush_all(); out.append("<hr>")
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.match(r"^:?-{2,}:?$", c) for c in cells):
                continue
            flush_para(); flush_list(); flush_quote()
            table = (table or []) + [cells]
            continue
        if line.startswith(">"):
            flush_para(); flush_list(); flush_table()
            quote.append(line[1:].strip())
            continue
        m = re.match(r"^\s*[-*]\s+(.*)$", line)
        if m:
            flush_para(); flush_table(); flush_quote()
            if lst and lst[0] == "ul":
                lst[1].append(m.group(1))
            else:
                flush_list(); lst = ("ul", [m.group(1)])
            continue
        m = re.match(r"^\s*\d+[.)]\s+(.*)$", line)
        if m:
            flush_para(); flush_table(); flush_quote()
            if lst and lst[0] == "ol":
                lst[1].append(m.group(1))
            else:
                flush_list(); lst = ("ol", [m.group(1)])
            continue
        if lst and line.startswith("  "):
            lst[1][-1] += " " + line.strip()
            continue
        flush_list(); flush_table(); flush_quote()
        para.append(line.strip())
    if code is not None:
        lang, lines = code
        out.append(f'<pre><code class="lang-{html.escape(lang)}">' + html.escape("\n".join(lines)) + "</code></pre>")
    flush_all()
    return "\n".join(out)
