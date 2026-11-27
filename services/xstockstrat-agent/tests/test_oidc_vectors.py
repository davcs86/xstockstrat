"""Shared OIDC vectors (feature 345): the agent's issuer grammar and mode parsing match the file."""

import json
from pathlib import Path

import pytest

from app import sso_mode

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[3] / "scripts" / "testdata" / "oidc-issuer-vectors.json"
    ).read_text(encoding="utf-8")
)


def test_issuer_pattern_equals_vector_literal():
    assert sso_mode.ISSUER_PATTERN == VECTORS["issuer_pattern"]


@pytest.mark.parametrize("row", VECTORS["issuer"], ids=lambda r: r["name"])
def test_issuer_vector(row):
    assert sso_mode.is_valid_issuer(row["value"]) is row["valid"]


@pytest.mark.parametrize("row", VECTORS["mode"], ids=lambda r: r["name"])
def test_mode_vector(row):
    assert sso_mode.parse_auth_mode(row["value"]) == (row["expected"], row["logs"])
