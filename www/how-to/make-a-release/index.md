# Make a release

> For maintainers: the rules while the files are frozen, the version file, cutting a release directory and its manifest, the checks, the pull request with a person and an agent reviewer, the deploy, the tag and the live check, then the consumers.

*api.newsroom.sgit.ai · v0.2.4 (reader code v0.2.0) · this file is generated from the same source as <https://api.newsroom.sgit.ai/how-to/make-a-release/>, so the two cannot drift. The site's index for agents: <https://api.newsroom.sgit.ai/llms.txt>.*

---

# Make a release

> A release is a directory that is never changed after it is on `dev`, the default branch. The tree is always exactly the release the version file names, or the check fails.

## The rules, while the files are frozen

Until phase 4 of [the brief](https://newsroom.sgit.ai/articles/explorer-to-villager-newsroom.html) is finished (the refactoring with every test passing, and the adversarial exercise), the served files change only as a new release, each change with a test that fails without it and a reason in the pull request. A fix to a finding is a deliberate change to the test that pinned it. A new reader feature is built here, as a new versioned file, never in the newsroom's tree.

## 1. Change, and test

Edit under the served paths (`assets/`, `for/`, `wire/`, `passkey/`); if the file is one of the meter's, it is a new component version at a new path, never an edit of `v1.4.0`. Run the tests in the three engines against the newsroom checkout ([running the tests](../run-the-tests/)).

## 2. Version and cut

`tools/version.json` holds two numbers and a date, all from the file, never the clock:

- **`version`**, the repository's version. Every change that lands on `dev` is a new one, in small increments: a patch for a small change (v0.2.1, v0.2.2, ...), a minor for a new capability. The deploy tags it, and refuses a version that is already a tag or not above the latest. CI on a branch fails when the version is not above `dev`'s.
- **`release`**, the latest cut of the reader code: `releases/<release>/`, what the consuming sites pin. It changes only when a served file changes; then it is set to the new version and cut.

```sh
$EDITOR tools/version.json          # {"version": "v0.2.3", "release": "v0.2.3", "date": "2026-10-20"} for a change to a served file;
                                    # {"version": "v0.2.3", "release": "v0.2.0", ...} for a change to the site, the tests or the tools
python3 tools/release.py cut        # (served files changed) releases/v0.2.3/<every served file> and manifest.json
python3 tools/release.py check      # every release matches its manifest; the tree is the release; the two numbers obey their rule
python3 site/build.py               # the site: the version in the bar, the release on /releases/
python3 site/check.py               # the site's gate: references, canonical, chrome, sitemap, llms, no key shapes
```

Add the version's line to `site/data/versions.json` (newest first); the build refuses a version without one, and `/versions/` shows them all.

`cut` refuses to write over an existing release directory, refuses a release that is not the repository's version, and refuses a file that differs from the newsroom's bytes unless `CHANGED_FROM_NEWSROOM` records why. Write a release's note at `site/releases/v0.2.3.md`.

## 3. The pull request

CI runs the syntax check, the manifest check, the build twice, the site check and the tests in three engines. A pull request needs one person and one agent reviewer; the agent's review is a required check. The description says what changed, which test fails without it, and why now.

## 4. Merge, deploy, tag, check

A push to `dev` (the default branch, and the release branch) runs `deploy-pages.yml`: the checks again, a tag of the version, the Pages deploy of `www/` and `releases/`, and then `tools/live_check.py`, which asks the live host for every file of the release and compares the hashes, retrying while Pages propagates. The release is live when that job is green, not before.

## 5. The consumers

Tell the newsroom (and sgit.ai, once it pins): [taking a release](../take-a-release/). The newsroom's release note names the API release it moved to.

## What never happens

A file under `releases/` is never edited. A tag is never moved. A release is never cut from a tree that differs from it. A served file is never loaded unversioned.

