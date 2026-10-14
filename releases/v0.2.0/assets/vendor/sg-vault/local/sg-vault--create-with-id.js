/* =================================================================================
   SGraph Vault — LOCAL PATCH, pending upstream: SGVault.create(…, { vaultId })
   (SGraph-AI__App__Send; the issue text is admin/notes/2026-10-12__upstream-create-with-vault-id.md)

   sg-vault--create-with-id.js — SGVault.createWithId(sgSend, passphrase, vaultId, options)

   Identical to SGVault.create in v0.2.3 (assets/vendor/sg-vault/v0.2.3/sg-vault/sg-vault.js,
   lines 45–91), except that the caller supplies the vault id instead of the library drawing one
   at random. A door vault needs this: its id and its passphrase are both derived from a passkey's
   PRF bytes (passkey/lab.js, doorFrom), so the address is known before anything is written.

   Two additions beyond create:
     - the address is checked first, with the same two reads SGVault.open makes before it loads a
       tree (the branch index, then the named ref); "HEAD ref missing" means free. An existing
       vault, or one that cannot be read, is never overwritten: the call throws with code EEXISTS.
     - options.cloneBranch names this client's clone branch, as SGVault.open accepts; the default
       is the library's 'web-ui'.

   Extends SGVault with a static method, in the same pattern as the library's own sg-vault--*.js
   files. Must load after sg-vault.js and sg-vault-crypto.js. Delete this file when upstream ships
   the option, and change the one caller (assets/newsroom-vault.js, createVaultWithId).
   ================================================================================= */

(function () {
    'use strict';

    if (typeof SGVault === 'undefined' || typeof SGVaultCrypto === 'undefined') {
        throw new Error('sg-vault--create-with-id.js must load after sg-vault.js and sg-vault-crypto.js')
    }

    SGVault.createWithId = async function (sgSend, passphrase, vaultId, options = {}) {
        if (!passphrase) throw new Error('Passphrase cannot be empty')
        if (!/^[a-z0-9]{4,24}$/.test(String(vaultId || ''))) {
            throw new Error('vault_id must be 4-24 lowercase alphanumeric characters')
        }

        const vault = new SGVault(sgSend)
        vault._passphrase = passphrase
        vault._vaultId    = String(vaultId)

        // 2. Derive all keys and deterministic file IDs (as create)
        const keys = await SGVaultCrypto.deriveKeys(passphrase, vault._vaultId)
        vault._readKey           = keys.readKey
        vault._writeKey          = keys.writeKey
        vault._hmacKey           = keys.hmacKey
        vault._refFileId         = keys.refFileId
        vault._branchIndexFileId = keys.branchIndexFileId
        vault._cloneBranch       = (options && options.cloneBranch) || 'web-ui'
        vault._cloneRefFileId    = await SGVaultCrypto.deriveBranchRefFileId(keys.hmacKey, vault._vaultId, vault._cloneBranch)

        // 3. Initialize component managers (as create)
        vault._initManagers()

        // The address must be free. These are the reads SGVault.open makes before it loads a tree:
        // the branch index, then the named ref it names (or the derived one). Nothing there is "free".
        // Anything that cannot be read (another key's vault at this id) counts as taken: never overwrite.
        let taken = false
        try {
            const idx   = await vault._refManager.readBranchIndex(vault._branchIndexFileId)
            const named = idx && idx.branches && idx.branches.find(b => b.branch_type === 'named')
            const refId = (named && named.head_ref_id) || vault._refFileId
            const head  = await vault._refManager.readRef(refId)
            taken = !!head || !!idx
        } catch (_) {
            taken = true
        }
        if (taken) {
            const e = new Error(`A vault already exists at ${vault._vaultId}: createWithId never overwrites one`)
            e.code = 'EEXISTS'
            throw e
        }
        // Leave the ref manager as create() leaves it: the named ref never read through it, so the
        // first publish arms its compare-and-swap exactly as it does after create().
        vault._refManager._rawRefs = undefined

        // 4. Create settings (as create)
        vault._settingsDefaulted = !options.name
        vault._settings = {
            vault_name:  options.name || 'Untitled Vault',
            vault_id:    vault._vaultId,
            created:     new Date().toISOString(),
            version:     3,
            description: options.description || ''
        }

        // 5. Create initial empty tree (as create)
        vault._tree = { '/': { type: 'folder', children: {} } }

        // 6. Initial commit + both refs + branch index as ONE POST /batch (as create)
        await vault._withBatch(async () => {
            await vault._commit('Initial vault creation')
            await vault._refManager.writeRef(vault._refFileId, vault._headCommitId)
            vault._namedHeadId = vault._headCommitId
            try { await vault._refManager.writeBranchIndex(vault._branchIndexFileId, vault._refFileId) } catch (_) {}
        })

        return vault
    }
})();
