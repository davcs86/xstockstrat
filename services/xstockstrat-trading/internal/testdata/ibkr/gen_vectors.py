"""Generate IBKR OAuth 1.0a reference vectors from the ibind reference client.

Reference: ibind @ 759ec3a127accfb03e76bcd54856d1421d986e6a (master, checked 2026-10-28).
Run from services/xstockstrat-trading:

    uv run --with "ibind[oauth] @ git+https://github.com/Voyz/ibind@759ec3a127accfb03e76bcd54856d1421d986e6a" python internal/testdata/ibkr/gen_vectors.py > internal/testdata/ibkr/vectors.json

Every client-side computation is an ibind call; only the IBKR server side (the encrypted access token secret,
B = g^b mod p, the LST signature) is simulated here. Output is deterministic for the committed keys.
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

from Crypto.Cipher import PKCS1_v1_5 as PKCS1_v1_5_Cipher
from Crypto.Hash import HMAC, SHA1, SHA256
from Crypto.Util.asn1 import DerSequence

from ibind.oauth.oauth1a import (
    calculate_live_session_token,
    calculate_live_session_token_prepend,
    generate_authorization_header_string,
    generate_base_string,
    generate_dh_challenge,
    generate_hmac_sha_256_signature,
    generate_rsa_sha_256_signature,
    read_private_key,
    validate_live_session_token,
)

IBIND_SHA = "759ec3a127accfb03e76bcd54856d1421d986e6a"
HERE = Path(__file__).resolve().parent

BASE_URL = "https://api.ibkr.com/v1/api"
REALM = "limited_poa"
CONSUMER_KEY = "TESTCONS1"
ACCESS_TOKEN = "testaccesstoken0123456789"
SECRET_PLAINTEXT = bytes(range(0x10, 0x30))  # fixed 32-byte access token secret
NONCES = ["nonceAAAAAAAAAAA", "nonceBBBBBBBBBBB"]
TIMESTAMP = "1700000000"
DH_RANDOM_HEX = "3f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"
DH_SERVER_B_START = 0x5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A5A
LST_EXPIRATION_MS = 1700086400000

REQUESTS = [
    ("ssodh_init", "POST", "/iserver/auth/ssodh/init", {}),
    ("portfolio_accounts", "GET", "/portfolio/accounts", {}),
    ("get_order", "GET", "/iserver/account/orders", {"orderId": "42"}),
    ("secdef_search_aapl", "GET", "/iserver/secdef/search", {"symbol": "AAPL", "types": "STK"}),
    ("secdef_search_brk_b", "GET", "/iserver/secdef/search", {"symbol": "BRK B", "types": "STK"}),
    ("place_order", "POST", "/iserver/account/U123/orders", {}),
    ("cancel_order", "DELETE", "/iserver/account/U123/order/42", {}),
]


def deterministic_randfunc(seed: bytes):
    stream = hashlib.shake_256(seed).digest(4096)
    pos = 0

    def randfunc(n: int) -> bytes:
        nonlocal pos
        out = stream[pos : pos + n]
        pos += n
        return out

    return randfunc


def encrypt_secret(public_key, seed: bytes) -> str:
    cipher = PKCS1_v1_5_Cipher.new(public_key, randfunc=deterministic_randfunc(seed))
    return base64.b64encode(cipher.encrypt(SECRET_PLAINTEXT)).decode()


def read_dh_params(pem: str) -> tuple[int, int]:
    body = "".join(line for line in pem.splitlines() if not line.startswith("-----"))
    seq = DerSequence()
    seq.decode(base64.b64decode(body))
    return int(seq[0]), int(seq[1])


def oauth_params(nonce: str, method: str) -> dict:
    return {
        "oauth_consumer_key": CONSUMER_KEY,
        "oauth_nonce": nonce,
        "oauth_signature_method": method,
        "oauth_timestamp": TIMESTAMP,
        "oauth_token": ACCESS_TOKEN,
    }


def main() -> None:
    signature_pem = (HERE / "signature_key.pem").read_text()
    encryption_pem = (HERE / "encryption_key.pem").read_text()
    signature_key = read_private_key(private_key_content=signature_pem)
    encryption_key = read_private_key(private_key_content=encryption_pem)
    dh_prime, dh_generator = read_dh_params((HERE / "dhparam.pem").read_text())
    dh_prime_hex = format(dh_prime, "x")

    access_token_secret = encrypt_secret(encryption_key.publickey(), b"ibkr-access-token-secret")
    wrong_key_ciphertext = encrypt_secret(signature_key.publickey(), b"ibkr-wrong-key")

    prepend = calculate_live_session_token_prepend(access_token_secret, encryption_key)
    assert prepend == SECRET_PLAINTEXT.hex()
    try:
        wrong = calculate_live_session_token_prepend(wrong_key_ciphertext, encryption_key)
    except AttributeError:
        wrong = ""  # older pycryptodome returns the None sentinel, so .hex() raises
    if wrong != "":
        raise AssertionError("wrong-key ciphertext decrypted")

    dh_challenge = generate_dh_challenge(dh_prime_hex, DH_RANDOM_HEX, dh_generator)

    lst_url = f"{BASE_URL}/oauth/live_session_token"
    lst_params = {**oauth_params(NONCES[0], "RSA-SHA256"), "diffie_hellman_challenge": dh_challenge}
    lst_base = generate_base_string("POST", lst_url, lst_params, prepend=prepend)
    lst_sig = generate_rsa_sha_256_signature(lst_base, signature_key)
    lst_header = generate_authorization_header_string({**lst_params, "oauth_signature": lst_sig}, REALM)

    a = int(DH_RANDOM_HEX, 16)
    dh_cases = {}
    b = DH_SERVER_B_START
    while len(dh_cases) < 2:
        dh_response = format(pow(dh_generator, b, dh_prime), "x")
        k_bitlen = pow(int(dh_response, 16), a, dh_prime).bit_length()
        name = "k_bitlen_mod8_zero" if k_bitlen % 8 == 0 else "k_bitlen_mod8_nonzero"
        if name not in dh_cases:
            dh_cases[name] = {
                "name": name,
                "dh_server_b_hex": format(b, "x"),
                "diffie_hellman_response": dh_response,
                "k_bitlen": k_bitlen,
                "live_session_token": calculate_live_session_token(dh_prime_hex, DH_RANDOM_HEX, dh_response, prepend),
            }
        b += 1

    reply = dh_cases["k_bitlen_mod8_zero"]
    lst = reply["live_session_token"]
    lst_signature = HMAC.new(base64.b64decode(lst), CONSUMER_KEY.encode(), digestmod=SHA1).hexdigest()
    assert validate_live_session_token(lst, lst_signature, CONSUMER_KEY)
    bad_signature = "0" * len(lst_signature)
    assert not validate_live_session_token(lst, bad_signature, CONSUMER_KEY)

    legacy_key = ("&" + access_token_secret).encode()
    requests = []
    for name, method, path, params in REQUESTS:
        url = f"{BASE_URL}{path}"
        for nonce in NONCES:
            headers = oauth_params(nonce, "HMAC-SHA256")
            base = generate_base_string(method, url, headers, request_params=params)
            sig = generate_hmac_sha_256_signature(base, lst)
            legacy = base64.b64encode(HMAC.new(legacy_key, base.encode(), digestmod=SHA256).digest()).decode()
            assert legacy != sig
            requests.append(
                {
                    "name": name,
                    "method": method,
                    "url": url,
                    "params": params,
                    "nonce": nonce,
                    "base_string": base,
                    "oauth_signature": sig,
                    "authorization": generate_authorization_header_string({**headers, "oauth_signature": sig}, REALM),
                    "legacy_signature_b64": legacy,
                }
            )

    vectors = {
        "meta": {"ibind_sha": IBIND_SHA, "generator": "internal/testdata/ibkr/gen_vectors.py"},
        "inputs": {
            "base_url": BASE_URL,
            "realm": REALM,
            "consumer_key": CONSUMER_KEY,
            "access_token": ACCESS_TOKEN,
            "access_token_secret": access_token_secret,
            "nonces": NONCES,
            "timestamp": TIMESTAMP,
            "dh_prime_hex": dh_prime_hex,
            "dh_generator": dh_generator,
            "dh_random_hex": DH_RANDOM_HEX,
        },
        "lst_request": {
            "method": "POST",
            "url": lst_url,
            "nonce": NONCES[0],
            "prepend": prepend,
            "diffie_hellman_challenge": dh_challenge,
            "base_string": lst_base,
            "oauth_signature": lst_sig,
            "authorization": lst_header,
        },
        "lst_reply": {
            "diffie_hellman_response": reply["diffie_hellman_response"],
            "live_session_token_expiration": LST_EXPIRATION_MS,
            "live_session_token_signature": lst_signature,
            "bad_live_session_token_signature": bad_signature,
            "live_session_token": lst,
        },
        "requests": requests,
        "decrypt": {
            "ciphertext_b64": access_token_secret,
            "plaintext_hex": prepend,
            "wrong_key_ciphertext_b64": wrong_key_ciphertext,
        },
        "dh_cases": [dh_cases["k_bitlen_mod8_zero"], dh_cases["k_bitlen_mod8_nonzero"]],
    }
    json.dump(vectors, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
