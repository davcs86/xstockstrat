"""Transport selection and port resolution (feature 079).

Two things are proven here, and the distinction matters:

  1. `resolve_transport()` / `resolve_http_port()` map env vars to values -- including the
     deprecated `MCP_TRANSPORT=sse` alias and the deprecated `MCP_SSE_PORT` fallback.
  2. `main()` actually USES `resolve_transport()` to pick a runner. Without (2), (1) is a pure
     function test that proves nothing about which server starts: the dispatch used to live in
     `if __name__ == "__main__":`, which pytest never executes, so a green suite could coexist
     with `MCP_TRANSPORT=sse` silently starting stdio in production.

The module is imported as a module and its attributes are read INSIDE test bodies on purpose. A
module-level `from app.main import resolve_transport` would break collection of the whole file
with an ImportError, which is not a valid red -- each case must fail on its own, for the right
reason.

`tests/conftest.py` has an autouse fixture that sets MCP_TRANSPORT=stdio, so every case asserting
an UNSET variable must `delenv` it. Writing those cases with `setenv` would silently assert
"stdio -> stdio" and pass for the wrong reason.
"""

import logging

import pytest

import app.main as main_mod


class TestMainDispatch:
    """`main()` must route the resolved transport to the right runner."""

    @pytest.mark.parametrize(
        ("transport", "expected"),
        [("sse", "http"), ("http", "http"), ("stdio", "stdio"), ("banana", "stdio")],
    )
    def test_main_selects_runner_from_resolved_transport(self, monkeypatch, transport, expected):
        monkeypatch.setenv("MCP_TRANSPORT", transport)
        monkeypatch.setattr("app.telemetry.init_telemetry", lambda: None)
        monkeypatch.setattr(main_mod, "_run_http", lambda: "http")
        monkeypatch.setattr(main_mod, "_run_stdio", lambda: "stdio")

        recorded: list[str] = []
        monkeypatch.setattr(main_mod.asyncio, "run", recorded.append)

        main_mod.main()

        assert recorded == [expected]


class TestResolveTransport:
    def test_http_is_canonical_and_warns_about_nothing(self, monkeypatch, caplog):
        monkeypatch.setenv("MCP_TRANSPORT", "http")
        with caplog.at_level(logging.WARNING, logger="app.main"):
            assert main_mod.resolve_transport() == "http"
        assert caplog.records == []

    def test_sse_is_a_deprecated_alias_for_http(self, monkeypatch, caplog):
        monkeypatch.setenv("MCP_TRANSPORT", "sse")
        with caplog.at_level(logging.WARNING, logger="app.main"):
            assert main_mod.resolve_transport() == "http"
        assert len(caplog.records) == 1
        assert "deprecated" in caplog.records[0].getMessage()

    def test_unset_defaults_to_stdio(self, monkeypatch, caplog):
        # delenv, not setenv -- conftest's autouse fixture already set this to "stdio".
        monkeypatch.delenv("MCP_TRANSPORT", raising=False)
        with caplog.at_level(logging.WARNING, logger="app.main"):
            assert main_mod.resolve_transport() == "stdio"
        assert caplog.records == []

    def test_unrecognized_value_falls_through_to_stdio_but_warns(self, monkeypatch, caplog):
        monkeypatch.setenv("MCP_TRANSPORT", "banana")
        with caplog.at_level(logging.WARNING, logger="app.main"):
            # Behavior is unchanged (AC-4): the value is returned as-is and, being != "http",
            # main() runs stdio. Only the diagnostic is new.
            assert main_mod.resolve_transport() == "banana"
        assert len(caplog.records) == 1
        assert "not recognized" in caplog.records[0].getMessage()


class TestResolveHttpPort:
    def test_mcp_http_port_is_honored(self, monkeypatch):
        monkeypatch.setenv("MCP_HTTP_PORT", "9111")
        monkeypatch.delenv("MCP_SSE_PORT", raising=False)
        assert main_mod.resolve_http_port() == 9111

    def test_mcp_sse_port_still_works_as_the_deprecated_fallback(self, monkeypatch):
        monkeypatch.delenv("MCP_HTTP_PORT", raising=False)
        monkeypatch.setenv("MCP_SSE_PORT", "9222")
        assert main_mod.resolve_http_port() == 9222

    def test_neither_set_defaults_to_9000(self, monkeypatch):
        monkeypatch.delenv("MCP_HTTP_PORT", raising=False)
        monkeypatch.delenv("MCP_SSE_PORT", raising=False)
        assert main_mod.resolve_http_port() == 9000

    def test_empty_new_var_falls_back_instead_of_raising(self, monkeypatch):
        # Deliberate behavior change (design.md §1): int("") used to raise ValueError at import.
        # The or-chain treats "" as absent. Pinned so it is not "fixed" back.
        monkeypatch.setenv("MCP_HTTP_PORT", "")
        monkeypatch.setenv("MCP_SSE_PORT", "9222")
        assert main_mod.resolve_http_port() == 9222
