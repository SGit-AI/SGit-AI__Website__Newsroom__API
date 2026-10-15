# Take a release, roll one back

> For a site that consumes the API: pin one release in one file, generate every URL from it, keep a copy of the manifest, check every page against it, and roll back by changing the line. The newsroom's procedure as the worked example.

*api.newsroom.sgit.ai · v0.2.10 (reader code v0.2.5) · this file is generated from the same source as <https://api.newsroom.sgit.ai/how-to/take-a-release/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Take a release, roll one back

> One file names the release. Everything else is generated from it, and a gate refuses anything that is not.

## 1. Pin

Write the release in one place your build reads, and copy that release's manifest beside it. The newsroom's:

```json
{"host": "https://api.newsroom.sgit.ai", "release": "{{release}}"}
```

```sh
curl -s https://api.newsroom.sgit.ai/{{release}}/manifest.json > admin/build/api-manifest.json
```

## 2. Generate every URL from the pin

Nothing in a page names a reader file by a relative path or by a release typed by hand. The newsroom's builders call `api_url(path)`; its sync points imported pages at the same URL; `python3 admin/build/api.py --repoint` rewrites every page in one pass when the pin changes, and `--rerecord` recomputes the content hashes its import gate keeps.

## 3. Gate it

Before a release of your site, check three things on every page: no reader file is loaded by a relative path; every reader file is loaded from the pinned release; every path loaded is in the manifest. The newsroom's `validate.js` check 14 does this; check 13 holds the frozen meter copies it still serves to the manifest's bytes. The checks are small because the rule is simple.

## 4. Verify the live host

After your deploy, ask this host for the hash of every file you load and compare with the manifest; `tools/live_check.py` in the repository does it for a release, with retries while Pages propagates. [Green does not mean live](https://newsroom.sgit.ai/articles/green-does-not-mean-live.html).

## 5. Roll back

Change the release in the pin to the previous one, copy its manifest, repoint, gate, deploy. A release directory is never edited in place, so the previous release is exactly what it was.

## Taking a new release

Read [its notes](../../releases/) first: a release says what changed, and lists any file that differs from the newsroom's bytes and why. Then steps 1 to 4. The frozen meter versions are in every release at their paths, so a page pinned to an older component version keeps working.

