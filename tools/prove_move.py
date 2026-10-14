#!/usr/bin/env python3
"""The move's proof: the newsroom serves the same bytes before and after, by hash.

    python3 tools/prove_move.py --before <newsroom tree at the commit before the move> --after <newsroom tree after it> \
                                [--out map/proof/<release>.json]

The brief's rule for the move (Go slow to go fast, rule 2): scripts, styles and JSON raw; HTML pages with the site chrome
and version stamps normalised, as the newsroom's validator does for imported pages, plus the one rule the move adds (a
reader-file reference, relative or on the API host, reads as API/<path>; admin/build/api.py in the newsroom and
validate.js check 11 mirror it).

Three comparisons:
  1. every served file (tools/served.json): its bytes here against its bytes in the before tree. Three files differ, by
     the lines the host forced (tools/release.py CHANGED_FROM_NEWSROOM); the report names them and nothing else may differ.
  2. the frozen meter copies the newsroom keeps: identical to the before tree and to this tree.
  3. every HTML page of the before tree: normalised, against the same page of the after tree normalised. Pages that
     differ are listed with the first differing line, so a reviewer sees that the differences are the release's own
     (the versions table, the engineering pages, the release note) and nothing a reader runs or reads.
"""
import argparse
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVED = json.loads((ROOT / "tools/served.json").read_text(encoding="utf-8"))
VERSION = json.loads((ROOT / "tools/version.json").read_text(encoding="utf-8"))

# The newsroom's normaliser (sync_newsroom.py NORMALISE, applied once each) and the move's rule (api.py NORMALISE).
CHROME = [
    (re.compile(r'<nav class="site">[\s\S]*?</nav>'), '<nav class="site"></nav>'),
    (re.compile(r'<footer class="site">[\s\S]*?</footer>'), '<footer class="site"></footer>'),
    (re.compile(r'<span class="llmschip-m">[^<]*</span>'), '<span class="llmschip-m"></span>'),
    (re.compile(r'· site v\d+\.\d+\.\d+ ·'), '· site ·'),
    (re.compile(r'<span>newsroom\.sgit\.ai &middot; v\d+\.\d+\.\d+</span>'), '<span>newsroom.sgit.ai &middot; </span>'),
]
HOST = "https://api.newsroom.sgit.ai"
_PATH = (r"(assets/(?:components|vault-pane|search|vendor/sg-vault)/[^\"'\s<>]+"
         r"|assets/(?:subscribe\.js|newsroom-vault\.js|door\.js)(?:\?[^\"'\s<>]*)?"
         r"|for/(?:reading-list|make)\.js|for/for\.css"
         r"|wire/(?:wire|vault-reader)\.js|wire/wire\.css"
         r"|passkey/(?:lab\.js|lab\.css|vectors\.json))")
SAME_DIR = {"reading-list.js": "for/", "make.js": "for/", "for.css": "for/", "wire.js": "wire/", "wire.css": "wire/",
            "vault-reader.js": "wire/", "lab.js": "passkey/", "lab.css": "passkey/", "vectors.json": "passkey/"}
_SAME = r"(" + "|".join(re.escape(k) for k in SAME_DIR) + r")"
API_RULES = [
    (re.compile(r"([\"'])" + re.escape(HOST) + r"/v\d+\.\d+\.\d+/" + _PATH + r"\1"), r"\1API/\2\1"),
    (re.compile(r"([\"'])(?:\./|(?:\.\./)+)?" + _PATH + r"\1"), r"\1API/\2\1"),
    (re.compile(r"([\"'])(?:\./)?" + _SAME + r"\1"), lambda m: f"{m.group(1)}API/{SAME_DIR[m.group(2)]}{m.group(2)}{m.group(1)}"),
]


def load_api_rules(after):
    """The move's own rule lives in the newsroom (admin/build/api.py NORMALISE): the after tree's copy is loaded and used,
    so the proof reads references exactly as the newsroom's gate does and the two cannot drift."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("newsroom_api", after / "admin/build/api.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.normalise


API_NORMALISE = None     # set in main() from the after tree; API_RULES above is the fallback when the tree has no api.py


def normalise(text):
    for p, r in CHROME:
        text = p.sub(r, text, count=1)
    if API_NORMALISE:
        return API_NORMALISE(text)
    for p, r in API_RULES:
        text = p.sub(r, text)
    return text


def sha(b):
    return hashlib.sha256(b).hexdigest()


def pages(tree):
    for p in sorted(tree.rglob("*.html")):
        parts = p.relative_to(tree).parts
        if ".git" in parts or "summit-archive" in parts or "vault-app" in parts or "node_modules" in parts:
            continue
        yield p.relative_to(tree).as_posix()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--out", default=str(ROOT / "map/proof" / f"{VERSION['release']}.json"))
    a = ap.parse_args()
    before, after = Path(a.before).resolve(), Path(a.after).resolve()
    global API_NORMALISE
    if (after / "admin/build/api.py").exists():
        API_NORMALISE = load_api_rules(after)
    manifest = json.loads((ROOT / "releases" / VERSION["release"] / "manifest.json").read_text(encoding="utf-8"))
    changed_ok = {f["path"] for f in manifest["files"] if "changed_from_newsroom" in f}
    report = {"what": __doc__.split("\n")[0], "release": VERSION["release"], "before": str(before), "after": str(after),
              "files": {"same": 0, "changed_as_recorded": [], "unexpected": []},
              "frozen": {"same": 0, "unexpected": []},
              "pages": {"compared": 0, "same": 0, "differ": [], "only_before": [], "only_after": []}}
    problems = []

    # 1. the served files: this tree against the before tree
    for rel in SERVED:
        b, h = before / rel, ROOT / rel
        if not b.exists():
            problems.append(f"{rel}: not in the before tree"); continue
        if sha(b.read_bytes()) == sha(h.read_bytes()):
            report["files"]["same"] += 1
        elif rel in changed_ok:
            report["files"]["changed_as_recorded"].append(rel)
        else:
            report["files"]["unexpected"].append(rel); problems.append(f"{rel}: differs from the before tree and is not a recorded change")

    # 2. the frozen copies the newsroom keeps
    for p in sorted((after / "assets/components").rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(after).as_posix()
        if (before / rel).exists() and (ROOT / rel).exists() and sha(p.read_bytes()) == sha((before / rel).read_bytes()) == sha((ROOT / rel).read_bytes()):
            report["frozen"]["same"] += 1
        else:
            report["frozen"]["unexpected"].append(rel); problems.append(f"{rel}: a frozen copy that is not the before tree's and this tree's bytes")

    # 3. every page, normalised
    pb, pa = set(pages(before)), set(pages(after))
    report["pages"]["only_before"] = sorted(pb - pa)
    report["pages"]["only_after"] = sorted(pa - pb)
    for rel in sorted(pb & pa):
        report["pages"]["compared"] += 1
        tb = normalise((before / rel).read_text(encoding="utf-8"))
        ta = normalise((after / rel).read_text(encoding="utf-8"))
        if tb == ta:
            report["pages"]["same"] += 1
        else:
            first = next((l for l in difflib.unified_diff(tb.splitlines(), ta.splitlines(), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")), "")
            report["pages"]["differ"].append({"page": rel, "first_difference": first[:240]})
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    f, z, g = report["files"], report["frozen"], report["pages"]
    print(f"proof: files: {f['same']} identical, {len(f['changed_as_recorded'])} changed as recorded ({', '.join(f['changed_as_recorded'])}), {len(f['unexpected'])} unexpected")
    print(f"proof: frozen copies: {z['same']} identical, {len(z['unexpected'])} unexpected")
    print(f"proof: pages: {g['compared']} compared, {g['same']} identical once normalised, {len(g['differ'])} differ, "
          f"{len(g['only_before'])} only before, {len(g['only_after'])} only after")
    for d in g["differ"]:
        print(f"  ~ {d['page']}: {d['first_difference']}")
    for x in g["only_after"]:
        print(f"  + {x}")
    for x in g["only_before"]:
        print(f"  - {x}")
    print(f"proof: written to {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
    if problems:
        print(f"proof: {len(problems)} problem(s)")
        for x in problems:
            print("  ✗ " + x)
        sys.exit(1)


if __name__ == "__main__":
    main()
