# The vault library, vendored: SG/Vault UI v0.2.3

The twelve files in this folder are the library that runs dev.vault.sgraph.ai, copied unchanged from
the SGraph-AI__App__Send repository so that newsroom.sgit.ai loads its vault code from its own origin
and from nowhere else. They are the one code base for creating, opening, reading, writing and pushing
a vault from a browser, as https://sgit.ai/docs/vault/vault-from-javascript.html recommends. A fix in
the library is picked up by refreshing this copy; nothing here is edited.

**Upstream:** https://github.com/the-cyber-boardroom/SGraph-AI__App__Send, branch `dev`,
commit `5d50ae83c06bc1d575b58c95aea9c921e5b56a73` (2026-09-09), folder
`sgraph_ai_app_send__ui__vault/v0/v0.2/v0.2.3/_common/js/lib/`. The sgit.ai page states that the
files served by dev.vault.sgraph.ai on 12 October 2026 were byte-identical to that folder.

**Load order** (plain scripts, each declaring a global; the `sg-vault--*.js` files add methods to
`SGVault.prototype`): as listed below.

| File | SHA-256 |
|---|---|
| `sg-send/sg-send-crypto.js` | `2c4af16bbaf4f43e7eb0f8298a9cd8338429f99c7bec20c5d7f4da96c88e39ce` |
| `sg-send/sg-send.js` | `9bc98e580f5fc1adbf8e2d273181e6afa3bd9a3813ea8a1bf24ddd07e1b8b41e` |
| `sg-vault/sg-vault-crypto.js` | `f8d31359204a9e333d27444ea2a37c1bb11bbc790d0cf4cfa95fe9f9282d6e66` |
| `sg-vault/sg-vault-object-store.js` | `a45d7ad0f9dbd91677785c3128a8322d4209cb35ab5d815551dcbf1eceed9c9e` |
| `sg-vault/sg-vault-ref-manager.js` | `5b8ea87ace83d59e8954511d9932bd3968020c57070375194c7427a083fb729f` |
| `sg-vault/sg-vault-commit.js` | `e686de3756eaeed185708a6ba96194429afb3067f145108e7580d876598dd9ce` |
| `sg-vault/sg-vault.js` | `0108884f9b8d539e4c9457190326d64adc5a92c808803f0dab14b9e772b3ad26` |
| `sg-vault/sg-vault--file-ops.js` | `f114db89754638b5e4ade1dc3f5d4753ac672a4323c286e8c8ed0412760e6861` |
| `sg-vault/sg-vault--folder-ops.js` | `10fea1377422c5368aead040500c28135fafcb918427901a74483e23e1b36d7f` |
| `sg-vault/sg-vault--sync.js` | `b9f521e7b70ca66f6d1197378337f954deea4ed3468535ec3064149c7cf1fcc6` |
| `sg-vault/sg-vault--history.js` | `265b215e27216ad25e8fa7c83b47c8307b7990a0a3fb88254ee2149d2835dd2d` |
| `sg-vault/sg-vault--branches.js` | `bc1eec8bbc2326a73ec1809ed588d26f3fe7511bf24b52e47440c3d90526f3d1` |

**The check.** `admin/build/validate.js` recomputes every hash above on each build and fails if one
differs, so an edit to a vendored file cannot ship. `admin/build/test_vault.mjs` loads these files
the way the page does and exercises them against a mock of the vault API and against sgit-ai 0.21.0.

**Local additions** live in `../local/`, never here: `sg-vault--create-with-id.js` adds
`SGVault.createWithId`, marked `LOCAL PATCH, pending upstream`, to be deleted when the library
ships `create(…, { vaultId })` (the issue text is in `admin/notes/2026-10-12__upstream-create-with-vault-id.md`).

**To refresh:** clone the upstream repository at the commit you are moving to, copy the twelve files
over these, rewrite the commit line and the table above (`sha256sum`), run the build, and read the
diff of the library before releasing: the newsroom's module (`assets/newsroom-vault.js`) relies on the
methods the sgit.ai page lists and on two underscore fields its `publish` helper names.
