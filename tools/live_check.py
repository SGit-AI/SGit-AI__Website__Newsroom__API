#!/usr/bin/env python3
"""Green does not mean live: after a deploy, ask api.newsroom.sgit.ai for every file of a release and compare the hashes.

    python3 tools/live_check.py                    # the release in tools/version.json
    python3 tools/live_check.py --release v0.1.0   # a given one
    python3 tools/live_check.py --wait 480         # keep trying for up to 480 s while Pages propagates
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "https://api.newsroom.sgit.ai"


def get(url):
    req = urllib.request.Request(url, headers={"cache-control": "no-cache", "user-agent": "newsroom-api live check"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--release", default=json.loads((ROOT / "tools/version.json").read_text())["release"])
    ap.add_argument("--wait", type=int, default=0, help="seconds to keep retrying while the host catches up")
    a = ap.parse_args()
    local = ROOT / "releases" / a.release / "manifest.json"
    manifest = json.loads(local.read_text(encoding="utf-8"))
    deadline = time.time() + a.wait
    while True:
        bad = []
        try:
            status, body, headers = get(f"{HOST}/{a.release}/manifest.json")
            if hashlib.sha256(body).hexdigest() != hashlib.sha256(local.read_bytes()).hexdigest():
                bad.append("manifest.json: the live manifest is not this one")
            if headers.get("access-control-allow-origin") != "*":
                bad.append("manifest.json: no access-control-allow-origin: * (a cross-origin import would fail)")
            for f in manifest["files"]:
                s, b, h = get(f"{HOST}/{a.release}/{f['path']}")
                if hashlib.sha256(b).hexdigest() != f["sha256"]:
                    bad.append(f"{f['path']}: live hash differs")
        except Exception as e:  # noqa: BLE001
            bad.append(f"{HOST}/{a.release}/: {e}")
        if not bad:
            print(f"live: {HOST}/{a.release}/ serves all {len(manifest['files'])} files as the manifest says, with CORS")
            return
        if time.time() >= deadline:
            print(f"live: {len(bad)} problem(s)")
            for x in bad[:20]:
                print("  ✗ " + x)
            sys.exit(1)
        print(f"live: not yet ({bad[0]}); retrying…")
        time.sleep(20)


if __name__ == "__main__":
    main()
