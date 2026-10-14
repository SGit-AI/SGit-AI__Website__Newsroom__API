#!/usr/bin/env python3
"""Test vectors for the passkey lab: the door derivation, computed in Python with sgit's own code.

    python3 admin/build/passkey_vectors.py          # writes passkey/vectors.json

The lab (passkey/lab.js) derives a door vault from a passkey's PRF bytes and then sgit's keys from the door,
in WebCrypto. The article's brief asks for test vectors shared with the sgit command line: the same inputs
through the browser and through sgit in Python, with the same keys out. This is the Python side. From a fixed,
fake PRF output (the SHA-256 of a public string) it computes:

    seed          HKDF-SHA256(ikm = prf, salt = SHA-256("newsroom.sgit.ai"), info = "sgit/door/v1", 32 bytes)
    passphrase    hex of HKDF-SHA256(ikm = seed, salt = empty, info = "sgit/door/v1/passphrase", 32 bytes)
    vault id      8 of [a-z0-9] from HKDF-SHA256(ikm = seed, salt = empty, info = "sgit/door/v1/id", 64 bytes),
                  taking a byte only when it is below 252 so that no character is favoured
    read key, write key, ref id, branch index id        sgit_ai.crypto.Vault__Crypto.derive_keys()
    a door record, encrypted deterministically           Vault__Crypto.encrypt_deterministic(read key, plaintext)
    its object id                                        Vault__Crypto.compute_object_id(ciphertext)

The HKDF steps are written out with hmac, so there is nothing to install beyond sgit-ai. The vault key itself
is not written to the file: the passphrase and the id are, and the page composes the string, so a derived
key for a vault that does not exist never sits in a tracked file in the form the key tripwire looks for.
"""
import hashlib
import hmac
import json
import sys
from importlib.metadata import version
from pathlib import Path

from sgit_ai.crypto.Vault__Crypto import Vault__Crypto, PBKDF2_ITERATIONS

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "passkey/vectors.json"
RP = "newsroom.sgit.ai"
ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
INPUT_TEXT = f"{RP}/door/v1/test-vector-1"
DOOR_RECORD = '{"kind":"door","v":1,"opens":"master","master":"a test vector, not a key","made":"2026-10-11T00:00:00Z","by":"the test vector"}'


def hkdf(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 with SHA-256. An empty salt is HMAC with an empty key, which is what WebCrypto does with one."""
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out, block, i = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([i]), hashlib.sha256).digest()
        out += block
        i += 1
    return out[:length]


def vault_id(seed: bytes, counter: int = 0) -> str:
    out = ""
    for rnd in range(8):
        info = "sgit/door/v1/id" + (f"/{counter}" if counter else "") + (f"/{rnd}" if rnd else "")
        for b in hkdf(seed, b"", info.encode(), 64):
            if b < 252:
                out += ALPHABET[b % 36]
            if len(out) == 8:
                return out
    return out


def door(ikm: bytes) -> dict:
    seed = hkdf(ikm, hashlib.sha256(RP.encode()).digest(), b"sgit/door/v1", 32)
    return {"seed": seed.hex(), "passphrase": hkdf(seed, b"", b"sgit/door/v1/passphrase", 32).hex(), "vault_id": vault_id(seed)}


def vectors() -> dict:
    c = Vault__Crypto()
    prf = hashlib.sha256(INPUT_TEXT.encode()).digest()
    d = door(prf)
    keys = c.derive_keys(d["passphrase"], d["vault_id"])
    read = keys["read_key_bytes"]
    ct = c.encrypt_deterministic(read, DOOR_RECORD.encode())
    assert c.decrypt(read, ct).decode() == DOOR_RECORD
    assert hmac.new(read, DOOR_RECORD.encode(), hashlib.sha256).digest()[:12] == ct[:12]
    return {
        "what": "Test vectors for the passkey lab (passkey/index.html): a fake PRF output and everything derived from it, "
                "computed in Python with sgit's own Vault__Crypto. The page computes the same in WebCrypto and compares.",
        "sgit_version": version("sgit-ai"), "pbkdf2_iterations": PBKDF2_ITERATIONS, "rp": RP,
        "input_text": INPUT_TEXT, "prf_hex": prf.hex(),
        "seed": d["seed"], "passphrase": d["passphrase"], "vault_id": d["vault_id"],
        "read_key": keys["read_key"], "write_key": keys["write_key"],
        "ref_file_id": keys["ref_file_id"], "branch_index_file_id": keys["branch_index_file_id"],
        "door_record_plaintext": DOOR_RECORD, "door_record_ct_hex": ct.hex(), "door_record_object_id": c.compute_object_id(ct),
        "note": "The deterministic ciphertext uses sgit's encrypt_deterministic (iv = HMAC-SHA256(key, plaintext)[:12]), so it can be compared byte for byte; a real door record is encrypted with a random iv.",
    }


def main():
    v = vectors()
    text = json.dumps(v, indent=1) + "\n"
    if not OUT.exists() or OUT.read_text() != text:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text)
        print(f"passkey_vectors: written for sgit-ai {v['sgit_version']}, door {v['vault_id']}")
    else:
        print(f"passkey_vectors: unchanged (door {v['vault_id']})")


if __name__ == "__main__":
    sys.exit(main())
