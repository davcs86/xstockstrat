"""The per-service copies of peer_identity.py must stay byte-identical (feature 360, D-35)."""

from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_COPIES = [
    _REPO / f"services/xstockstrat-{svc}/app/peer_identity.py"
    for svc in ("ingest", "indicators", "agent")
]


def test_peer_identity_copies_exist_and_are_identical():
    missing = [str(p.relative_to(_REPO)) for p in _COPIES if not p.is_file()]
    assert not missing, missing
    reference = _COPIES[0].read_bytes()
    differing = [str(p.relative_to(_REPO)) for p in _COPIES[1:] if p.read_bytes() != reference]
    assert not differing, differing
