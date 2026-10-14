#!/usr/bin/env python3
"""Releases of the reader code: cut, check, and assemble the site that api.newsroom.sgit.ai serves.

    python3 tools/release.py cut                 # releases/<version>/: the served files, copied from the tree, and manifest.json
    python3 tools/release.py cut --out DIR       # the same into DIR (the reproducible-build check cuts twice and compares)
    python3 tools/release.py check               # every release matches its manifest; the tree equals the current release
    python3 tools/release.py site --out DIR      # the Pages site: DIR/<version>/..., DIR/index.html, DIR/releases.json, CNAME

What is served is the list in tools/served.json: the files the newsroom's reader runs, at the paths they had there
(the brief's rule for the move: identical paths under the new host, so the move is a prefix rewrite and the proof
is a hash). A release is tools/version.json (release, date: both from the file, never from the clock, so a build
is the same bytes twice). The served URL of a file is https://api.newsroom.sgit.ai/<release>/<path>.

A release directory, once on main, is never changed (finding R16: a change is a new version path, always). `check`
recomputes every hash in every manifest, and fails when the tree differs from the release that tools/version.json
names: bump the version and cut again. The consuming sites pin a release and copy its manifest; their gates check
each file they load is in it, and a release ends by asking the live host for the hash of every file.
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "https://api.newsroom.sgit.ai"
SERVED = json.loads((ROOT / "tools/served.json").read_text(encoding="utf-8"))
VERSION = json.loads((ROOT / "tools/version.json").read_text(encoding="utf-8"))
RELEASES = ROOT / "releases"
# the "before" of the latest cut: the newest map/before/<newsroom release>/hashes.json by version
BEFORE = json.loads(max((ROOT / "map/before").glob("v*/hashes.json"), key=lambda p: [int(x) for x in p.parent.name[1:].split(".")]).read_text(encoding="utf-8"))
BEFORE_SHA = {f["path"]: f["sha256_raw"] for f in BEFORE["files"]}

# The files the host forced to change, and why. Everything else is the newsroom's bytes, unchanged.
CHANGED_FROM_NEWSROOM = {
    "assets/vault-pane/vault-pane.js": "took the site root from its own URL (import.meta.url); now from the page's data-root, and loads the vault library from its own root (CODE)",
    "assets/search/search.js": "took the site root from its own URL; now from the page's data-root for data and links, and imports the pane's modules from its own root (CODE)",
    "assets/search/ask.js": "took the site root from its own URL; now from the page's data-root for links",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def manifest_for(files_root):
    files = []
    for rel in SERVED:
        data = (files_root / rel).read_bytes()
        entry = {"path": rel, "bytes": len(data), "sha256": sha(data)}
        before = BEFORE_SHA.get(rel)
        if before is not None and before != entry["sha256"]:
            if rel not in CHANGED_FROM_NEWSROOM:
                sys.exit(f"release: {rel} differs from the newsroom's bytes at {BEFORE['newsroom_release']} and is not a "
                         f"recorded change; the move's rule is the same bytes (tools/release.py CHANGED_FROM_NEWSROOM)")
            entry["changed_from_newsroom"] = {"sha256_before": before, "why": CHANGED_FROM_NEWSROOM[rel]}
        files.append(entry)
    return {
        "what": f"A release of the newsroom's reader code, served at {HOST}/{VERSION['release']}/<path>. Scripts, styles, "
                "templates and JSON the browser runs on newsroom.sgit.ai (and sgit.ai), at the paths they had in the newsroom "
                "repository; the same bytes, apart from the files listed with changed_from_newsroom, which the move to a "
                "host of their own forced.",
        "release": VERSION["release"],
        "date": VERSION["date"],
        "host": HOST,
        "newsroom_before": {"release": BEFORE["newsroom_release"], "commit": BEFORE["newsroom_commit"]},
        "counts": {"files": len(files), "bytes": sum(f["bytes"] for f in files),
                   "changed_from_newsroom": sum(1 for f in files if "changed_from_newsroom" in f)},
        "files": files,
    }


def cut(out):
    for rel in SERVED:
        src = ROOT / rel
        if not src.exists():
            sys.exit(f"release: {rel} is in tools/served.json and not in the tree")
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
    m = manifest_for(out)
    (out / "manifest.json").write_text(json.dumps(m, indent=1) + "\n", encoding="utf-8")
    return m


def check():
    errors = []
    for rel in SERVED:
        if not (ROOT / rel).exists():
            errors.append(f"{rel} is in tools/served.json and not in the tree")
    for d in sorted(RELEASES.glob("v*")) if RELEASES.exists() else []:
        mf = d / "manifest.json"
        if not mf.exists():
            errors.append(f"{d.name}: no manifest.json"); continue
        m = json.loads(mf.read_text(encoding="utf-8"))
        if m["release"] != d.name:
            errors.append(f"{d.name}: the manifest says {m['release']}")
        for f in m["files"]:
            p = d / f["path"]
            if not p.exists():
                errors.append(f"{d.name}: {f['path']} is in the manifest and missing"); continue
            if sha(p.read_bytes()) != f["sha256"]:
                errors.append(f"{d.name}: {f['path']} does not hash as its manifest says; a release is never edited in place")
        extra = {p.relative_to(d).as_posix() for p in d.rglob("*") if p.is_file()} - {f["path"] for f in m["files"]} - {"manifest.json"}
        for x in sorted(extra):
            errors.append(f"{d.name}: {x} is in the release directory and not in its manifest")
    cur = RELEASES / VERSION["release"]
    if not cur.exists():
        errors.append(f"tools/version.json says {VERSION['release']} and releases/{VERSION['release']}/ does not exist; run `tools/release.py cut`")
    else:
        for rel in SERVED:
            a, b = ROOT / rel, cur / rel
            if a.exists() and b.exists() and a.read_bytes() != b.read_bytes():
                errors.append(f"{rel} in the tree differs from releases/{VERSION['release']}/; a change is a new release: bump tools/version.json and cut")
        want = manifest_for(ROOT)
        have = json.loads((cur / "manifest.json").read_text(encoding="utf-8"))
        if want["files"] != have["files"]:
            errors.append(f"releases/{VERSION['release']}/manifest.json does not describe the tree; cut again")
    return errors


def site(out):
    """The Pages site: the website (www/, written by site/build.py) at the root, and one directory per release beside it."""
    out.mkdir(parents=True, exist_ok=True)
    www = ROOT / "www"
    if www.exists():
        shutil.copytree(www, out, dirs_exist_ok=True)
    rels = []
    for d in sorted(RELEASES.glob("v*"), key=lambda p: [int(x) for x in p.name[1:].split(".")]):
        m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        shutil.copytree(d, out / d.name, dirs_exist_ok=True)
        rels.append({"release": m["release"], "date": m["date"], "files": m["counts"]["files"], "bytes": m["counts"]["bytes"],
                     "manifest": f"{HOST}/{m['release']}/manifest.json"})
    if not (out / "releases.json").exists():      # the website writes it; without the website, a plain index
        index = {"what": "The releases of the newsroom's reader code served from this host. A consuming site pins one; nothing here is "
                         "edited after it is published.", "host": HOST, "current": VERSION["release"], "releases": rels}
        (out / "releases.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    shutil.copyfile(ROOT / "CNAME", out / "CNAME")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    return rels


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["cut", "check", "site"])
    ap.add_argument("--out", help="cut: where to write instead of releases/<version>/; site: where to assemble (required)")
    a = ap.parse_args()
    if a.cmd == "cut":
        out = Path(a.out).resolve() if a.out else RELEASES / VERSION["release"]
        if out.exists() and not a.out:
            sys.exit(f"release: {out.relative_to(ROOT)} exists; a release is never edited in place. Bump tools/version.json for a new one")
        m = cut(out)
        print(f"release: {m['release']} ({m['date']}): {m['counts']['files']} files, {m['counts']['bytes']:,} bytes, "
              f"{m['counts']['changed_from_newsroom']} changed from the newsroom -> {out}")
    elif a.cmd == "check":
        errors = check()
        if errors:
            print(f"release: {len(errors)} error(s)")
            for e in errors:
                print("  ✗ " + e)
            sys.exit(1)
        n = len(list(RELEASES.glob("v*/manifest.json")))
        print(f"release: OK: {n} release(s) match their manifests; the tree is {VERSION['release']}")
    else:
        if not a.out:
            sys.exit("release: site needs --out DIR")
        rels = site(Path(a.out).resolve())
        print(f"release: site assembled with {len(rels)} release(s) at {a.out}")


if __name__ == "__main__":
    main()
