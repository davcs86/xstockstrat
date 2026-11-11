#!/usr/bin/env python3
"""Fail when a provisioned alert/dashboard queries a signal nothing produces, or docs name missing assets.

Usage: check-otel-produced-signals.py [ROOT]

  Registry  packages/otel/produced-signals.tsv: kind | identifier | producer-path | producer-literal.
            Every row's literal must still exist in one of its producer paths (AC-8 P1-producer).
  Part 1    alerts/*.yaml and dashboards/*.json (AC-8): every PromQL metric identifier, Loki service_name
            value and Loki |= / |~ literal in an expr must be registered.
  Part 3    docs/ + packages/otel (AC-3): named assets exist, counts match, removed assets are fenced.
  Part 5    (AC-8/AC-14): every alert rule declares noDataState (OK for the RPC rules, Alerting for the
            stall heartbeat), and the stall rule carries the label the mute timing keys on.
  Part 4    (AC-17): every rpc_server_duration_milliseconds_* selector excludes the proto-derived
            server-streaming methods; no trace sampler or gRPC-exclusion env in deploy specs (.do/*,
            docker-compose.yml, deploy/homelab/compose.yml); no OTEL_RESOURCE_ATTRIBUTES there (AC-22).
  Part 6    (AC-10/AC-11): docs/patterns/observability.md holds exactly one PromQL and one LogQL
            `otel-guard:host-provider` block, balanced, registered, and filtering both env and provider.

Each hit prints "AC-n <tag> <relpath>:<line>: <text>" to stderr; exit 1 on any hit.
"""

import os
import re
import sys

A = re.ASCII
OTEL = "packages/otel"
REGISTRY = f"{OTEL}/produced-signals.tsv"
OPEN = "<!-- otel-guard:removed-assets -->"
CLOSE = "<!-- /otel-guard:removed-assets -->"
MUTE_TIMING = "outside-us-market-hours"
STALL_RULE = "xstk-analysis-no-scoring"
RPC_RULES = ("xstk-error-rate-high", "xstk-p99-latency-high")
GENERAL_DOCS = (
    "docs/setup/grafana-cloud.md",
    "docs/setup/CLAUDE.md",
    "docs/patterns/observability.md",
    "docs/launch-pdfs/product-features.md",
)
SKIPPED_PREFIXES = ("docs/roadmap/", "docs/reports/")
SCANNED_SUFFIXES = (".md", ".yaml", ".yml")
SAMPLER_ENV = re.compile(
    r"OTEL_TRACES_SAMPLER|OTEL_PYTHON_GRPC_EXCLUDED_SERVICES|OTEL_PYTHON_GRPC_EXCLUDE_SERVICES"
)
RESATTR_ENV = re.compile(r"OTEL_RESOURCE_ATTRIBUTES")
DEPLOY_COMPOSES = ("docker-compose.yml", "deploy/homelab/compose.yml")
OBS_DOC = "docs/patterns/observability.md"
QUERY_TAG = "otel-guard:host-provider"
PROMQL_JOIN = (
    "on (job, instance, deployment_environment) group_left (host_provider)",
    "group by (job, instance, deployment_environment, host_provider)",
)
LOGQL_FILTERS = ('| deployment_environment="staging"', '| host_provider="homelab"')
WHITESPACE = re.compile(r"\s+", A)

FENCE_LINE = re.compile(
    rf"^- `(xstk-[a-z0-9-]+|{MUTE_TIMING}|[a-z0-9-]+\.(json|yaml))`( — | - |: )"
    r"(alert rule|mute timing|dashboard|file)$"
)
ASSET_NAME = re.compile(rf"xstk-[a-z0-9]+(-[a-z0-9]+)*|{MUTE_TIMING}")
ASSET_FILE = re.compile(r"[A-Za-z0-9_./-]+\.(json|yaml)")
COUNT_WORDS = (
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
)
COUNT_CLAIM = re.compile(
    rf"(^|[^a-z0-9])({'|'.join(COUNT_WORDS)}|[0-9]+)\s+(v1\s+)?(dashboards?|alert rules?)",
    A,
)

PROTO_COMMENT = re.compile(r"^\s*//", A)
PROTO_RPC = re.compile(r"^\s*rpc\s+([A-Za-z0-9_]+)", A)
PROTO_STREAM = re.compile(r"returns\s*\(\s*stream\s", A)
RPC_SELECTOR = re.compile(r"rpc_server_duration_milliseconds_(count|bucket|sum)")

PROMQL_KEYWORDS = frozenset(
    ("and", "or", "unless", "bool", "offset", "inf", "nan", "start", "end")
)
LOKI_LITERAL = re.compile(r'\|[=~]\s*"((?:[^"\\]|\\.)*)"', A)
LOKI_SERVICE = re.compile(r'service_name\s*=\s*"([^"]*)"', A)
QUOTED = re.compile(r'"(?:[^"\\]|\\.)*"')
LABEL_VALUES = re.compile(r"^\s*label_values\(", A)
LABEL_VALUES_ARGS = re.compile(r",[^)]*\)\s*$", A)
PIPE_STAGE = re.compile(
    r"\|\s*[A-Za-z_][A-Za-z0-9_]*(\s*(=~|!~|!=|==|=|>=|<=|>|<)\s*[A-Za-z0-9_.]*)?", A
)
BRACES = re.compile(r"\{[^}]*\}")
BRACKETS = re.compile(r"\[[^]]*\]")
GROUPING = re.compile(r"(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)", A)
IDENTIFIER = re.compile(r"[A-Za-z_:][A-Za-z0-9_:]*")
CALL = re.compile(r"^\s*\(", A)

EXPR_BLOCK = re.compile(r"^(\s*)expr:\s*[|>][-+]?\s*$", A)
EXPR_INLINE = re.compile(r"^\s*expr:\s*([^|>\s].*)$", A)
EXPR_QUOTES = re.compile(r"^[\"']|[\"']\s*$", A)
DASH_EXPR = re.compile(r'^\s*"expr": "(.*)"\s*,?\s*$', A)
DASH_QUERY = re.compile(r'^\s*"query": "(label_values.*)"\s*,?\s*$', A)
DASH_UID = re.compile(r'^  "uid": "([^"]*)"')

TOP_KEY = re.compile(r"^[A-Za-z_]")
UID_LINE = re.compile(r"^\s*- uid:\s*(.*)$", A)
NAME_LINE = re.compile(r"^\s*name:\s*(.*)$", A)
YAML_COMMENT = re.compile(r"\s+#.*", A)
NODATA_LINE = re.compile(r"^\s*noDataState:\s*(.*)$", A)
MUTED_LABEL = re.compile(r'^\s*mute_outside_market_hours:\s*"?true"?\s*$', A)
MUTE_NAME = re.compile(rf"^\s+name:\s*{MUTE_TIMING}\s*$", A)
SPACE_OR_QUOTE = re.compile(r'[\s"]', A)
BLANK = re.compile(r"^\s*$", A)
LEADING_SPACE = re.compile(r"^\s*", A)
FIRST_SPACE = re.compile(r"\s", A)


def read_text(path):
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        return f.read()


def split_lines(text):
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def listing(directory, suffix):
    """Sorted non-hidden files in a directory with the given suffix; [] when it is not a directory."""
    try:
        names = sorted(
            n
            for n in os.listdir(directory)
            if n.endswith(suffix) and not n.startswith(".")
        )
    except (FileNotFoundError, NotADirectoryError):
        return []
    return [os.path.join(directory, n) for n in names]


def files_under(base):
    """Regular files under base (symlinks excluded), as absolute paths."""
    out = []
    for dirpath, _, filenames in os.walk(base):
        for name in filenames:
            path = os.path.join(dirpath, name)
            if not os.path.islink(path) and os.path.isfile(path):
                out.append(path)
    return out


class Guard:
    def __init__(self, root):
        self.root = root
        self.hits = []
        self.registered = set()
        self.want_matcher = ""
        self.names = set()
        self.files = set()
        self.rules = 0
        self.dashboards = 0

    def path(self, rel):
        return os.path.join(self.root, rel)

    def rel(self, path):
        return os.path.relpath(path, self.root).replace(os.sep, "/")

    def hit(self, ac, tag, rel, line, text):
        self.hits.append(f"{ac} {tag} {rel}:{line}: {text}")

    # --- Registry ---------------------------------------------------------------------------------
    def load_registry(self):
        if not os.path.isfile(self.path(REGISTRY)):
            self.hit("AC-8", "P1-producer", REGISTRY, 1, "registry missing")
            return
        for ln, line in enumerate(split_lines(read_text(self.path(REGISTRY))), 1):
            fields = re.split(r"\t+", line.strip("\t"), maxsplit=3) if ln > 1 else [""]
            if not fields[0]:
                continue
            kind, ident, paths, literal = (fields + ["", "", ""])[:4]
            self.registered.add((kind, ident))
            if not any(self.produces(p, literal) for p in paths.split(",") if p):
                self.hit("AC-8", "P1-producer", REGISTRY, ln, f"{kind} {ident}")

    def produces(self, rel, literal):
        return os.path.isfile(self.path(rel)) and literal in read_text(self.path(rel))

    # --- Part 4: server-streaming methods, derived from the protos -------------------------------
    def load_stream_matcher(self):
        streams, unary = set(), set()
        proto_root = self.path("packages/proto")
        services = os.listdir(proto_root) if os.path.isdir(proto_root) else []
        protos = [
            p
            for svc in services
            for p in listing(os.path.join(proto_root, svc, "v1"), ".proto")
        ]
        for proto in sorted(protos):
            for ln, line in enumerate(split_lines(read_text(proto)), 1):
                m = None if PROTO_COMMENT.match(line) else PROTO_RPC.match(line)
                if not m:
                    continue
                if "returns" not in line:
                    self.hit(
                        "AC-17",
                        "P4",
                        f"{self.rel(proto)}:{ln}",
                        1,
                        "rpc line without returns",
                    )
                elif PROTO_STREAM.search(line):
                    streams.add(m.group(1))
                else:
                    unary.add(m.group(1))
        for name in sorted(streams & unary):
            self.hit(
                "AC-17",
                "P4",
                "packages/proto",
                1,
                f"stream rpc {name} shares its name with a unary rpc",
            )
        if streams:
            self.want_matcher = f'rpc_method!~"{"|".join(sorted(streams))}"'

    def check_streams(self, rel, ln, expr):
        """Every rpc_server_duration selector must carry the exact stream matcher."""
        if not self.want_matcher:
            return
        for row in selector_lacks(RPC_SELECTOR, self.want_matcher, expr):
            self.hit("AC-17", "P4", rel, ln, row)

    # --- Part 1: every queried signal is registered ----------------------------------------------
    def check_expr(self, rel, ln, expr, templating=False):
        if not templating:
            self.check_streams(rel, ln, expr)
        for literal in LOKI_LITERAL.findall(expr):
            if ("loki-literal", literal) not in self.registered:
                self.hit("AC-8", "P1", rel, ln, f'|= "{literal}"')
        for service in LOKI_SERVICE.findall(expr):
            if ("loki-service", service) not in self.registered:
                self.hit("AC-8", "P1", rel, ln, f'service_name="{service}"')
        for metric in metric_identifiers(expr):
            if ("metric", metric) not in self.registered:
                self.hit("AC-8", "P1", rel, ln, metric)

    def check_queries(self):
        for path in listing(self.path(f"{OTEL}/alerts"), ".yaml"):
            for ln, expr in alert_exprs(split_lines(read_text(path))):
                self.check_expr(self.rel(path), ln, expr)
        for path in listing(self.path(f"{OTEL}/dashboards"), ".json"):
            lines = split_lines(read_text(path))
            for pattern, templating in ((DASH_EXPR, False), (DASH_QUERY, True)):
                for ln, line in enumerate(lines, 1):
                    m = pattern.match(line)
                    if m:
                        self.check_expr(
                            self.rel(path),
                            ln,
                            m.group(1).replace('\\"', '"'),
                            templating,
                        )

    # --- Existence sets (value lines only: a comment can never make a deleted asset count) -------
    def load_assets(self):
        for path in listing(self.path(f"{OTEL}/alerts"), ".yaml"):
            section = ""
            for line in split_lines(read_text(path)):
                if TOP_KEY.match(line):
                    section = line.split(":", 1)[0]
                    continue
                if not section or section.startswith("delete"):
                    continue
                uid, name = UID_LINE.match(line), NAME_LINE.match(line)
                value = name or uid
                if value:
                    self.names.add(
                        YAML_COMMENT.sub("", value.group(1), count=1)
                        .rstrip()
                        .replace('"', "")
                    )
                    self.rules += 0 if name else 1
        for path in listing(self.path(f"{OTEL}/dashboards"), ".json"):
            self.dashboards += 1
            self.names.update(
                m.group(1)
                for m in map(DASH_UID.match, split_lines(read_text(path)))
                if m
            )
        for path in files_under(self.path(OTEL)):
            self.files.update((self.rel(path), os.path.basename(path)))

    def file_exists(self, token):
        inner = token.removeprefix(f"{OTEL}/")
        if os.path.exists(self.path(token)) or os.path.exists(
            self.path(f"{OTEL}/{inner}")
        ):
            return True
        return "/" not in token and token in self.files

    # --- Part 3 ----------------------------------------------------------------------------------
    def check_fenced(self, rel, ln, text):
        m = FENCE_LINE.match(text)
        if not m or m.group(1) in self.names or m.group(1) in self.files:
            self.hit("AC-3", "P3-fence", rel, ln, text)

    def check_count(self, rel, ln, claim, line):
        word = FIRST_SPACE.split(claim, maxsplit=1)[0]
        want = str(COUNT_WORDS.index(word) + 1) if word in COUNT_WORDS else word
        real = self.dashboards if "dashboard" in claim else self.rules
        if want != str(real):
            self.hit("AC-3", "P3-count", rel, ln, line)

    def scan_doc(self, path, rel, general):
        fence_start = 0
        for ln, line in enumerate(split_lines(read_text(path)), 1):
            if line == OPEN:
                if fence_start:
                    self.hit("AC-3", "P3-fence", rel, ln, "nested fence")
                else:
                    fence_start = ln
            elif line == CLOSE:
                if not fence_start:
                    self.hit(
                        "AC-3",
                        "P3-fence",
                        rel,
                        ln,
                        "closing marker without an opening marker",
                    )
                fence_start = 0
            elif fence_start:
                if not BLANK.match(line):
                    self.check_fenced(rel, ln, line.strip("\t"))
            else:
                for m in ASSET_NAME.finditer(line):
                    if m.group(0) not in self.names and m.group(0) not in self.files:
                        self.hit("AC-3", "P3-name", rel, ln, line)
                if general:
                    for m in ASSET_FILE.finditer(line):
                        if not self.file_exists(m.group(0)):
                            self.hit("AC-3", "P3-file", rel, ln, line)
                    for claim in count_claims(line.lower()):
                        self.check_count(rel, ln, claim, line)
        if fence_start:
            self.hit("AC-3", "P3-fence", rel, fence_start, "unclosed fence")

    def check_docs(self):
        paths = []
        for base in ("docs", OTEL):
            paths += [
                p for p in files_under(self.path(base)) if p.endswith(SCANNED_SUFFIXES)
            ]
        for rel in sorted(self.rel(p) for p in paths):
            in_alerts = rel.startswith(f"{OTEL}/alerts/") and rel.endswith(".yaml")
            if rel.startswith(SKIPPED_PREFIXES) or in_alerts:
                continue
            self.scan_doc(
                self.path(rel), rel, rel in GENERAL_DOCS or rel.startswith(f"{OTEL}/")
            )

    # --- Part 6: the documented host.provider queries (AC-10 PromQL, AC-11 LogQL) ----------------
    def check_query_blocks(self):
        blocks = (
            query_blocks(split_lines(read_text(self.path(OBS_DOC))))
            if os.path.isfile(self.path(OBS_DOC))
            else []
        )
        for lang, ac in (("promql", "AC-10"), ("logql", "AC-11")):
            mine = [(ln, expr) for kind, ln, expr in blocks if kind == lang]
            if len(mine) != 1:
                self.hit(
                    ac,
                    "P6",
                    OBS_DOC,
                    mine[0][0] if mine else 1,
                    f"expected exactly one {lang} {QUERY_TAG} block, found {len(mine)}",
                )
            for ln, expr in mine:
                if not balanced(expr):
                    self.hit(ac, "P6", OBS_DOC, ln, f"unbalanced {lang} block")
                    continue
                self.check_expr(OBS_DOC, ln, expr)
                for row in query_block_misses(lang, expr):
                    self.hit(ac, "P6", OBS_DOC, ln, row)

    # --- Part 5: alert rule invariants -----------------------------------------------------------
    def check_rules(self):
        mute_rel = f"{OTEL}/alerts/mute-timings.yaml"
        mute_ok = os.path.isfile(self.path(mute_rel)) and any(
            MUTE_NAME.match(line)
            for line in split_lines(read_text(self.path(mute_rel)))
        )
        rel = f"{OTEL}/alerts/alert-rules.yaml"
        if not os.path.isfile(self.path(rel)):
            return
        for ln, uid, nodata, muted in alert_rules(
            split_lines(read_text(self.path(rel)))
        ):
            if not nodata:
                self.hit("AC-8", "P5", rel, ln, f"{uid} has no noDataState")
            elif uid in RPC_RULES and nodata != "OK":
                self.hit(
                    "AC-8", "P5", rel, ln, f"{uid} noDataState must be OK, got {nodata}"
                )
            elif uid == STALL_RULE and nodata != "Alerting":
                self.hit(
                    "AC-8",
                    "P5",
                    rel,
                    ln,
                    f"{uid} noDataState must be Alerting, got {nodata}",
                )
            if uid == STALL_RULE:
                if not muted:
                    self.hit(
                        "AC-14",
                        "P5",
                        rel,
                        ln,
                        f"{uid} lacks the mute_outside_market_hours label",
                    )
                if not mute_ok:
                    self.hit(
                        "AC-14", "P5", mute_rel, 1, f"{MUTE_TIMING} mute timing missing"
                    )

    # --- Part 4: the span-derived metrics need every inbound span sampled ------------------------
    def check_samplers(self):
        specs = [*listing(self.path(".do"), ""), *map(self.path, DEPLOY_COMPOSES)]
        for path in specs:
            if not os.path.isfile(path):
                continue
            for ln, line in enumerate(split_lines(read_text(path)), 1):
                if SAMPLER_ENV.search(line):
                    self.hit("AC-17", "P4-sampler", self.rel(path), ln, line)
                # Feature 332 AC-22: some SDKs let this env override the host.provider attribute.
                if RESATTR_ENV.search(line):
                    self.hit("AC-22", "P4-resattr", self.rel(path), ln, line)

    def run(self):
        self.load_registry()
        self.load_stream_matcher()
        self.check_queries()
        self.load_assets()
        self.check_docs()
        self.check_query_blocks()
        self.check_rules()
        self.check_samplers()
        return self.hits


def selector_lacks(pattern, want, expr):
    """One row per selector of pattern whose label matchers lack want (bare selector included)."""
    rows = []
    for m in pattern.finditer(expr):
        rest = expr[m.end() :]
        if not rest.startswith("{"):
            rows.append(f"{m.group(0)} (no label matchers)")
        elif want not in rest[1:].split("}", 1)[0]:
            rows.append(f"{m.group(0)} (missing {want})")
    return rows


def query_blocks(lines):
    """[(lang, start line, expr)] per tagged fenced block, its lines joined by spaces."""
    out, lang, start, parts = [], None, 0, []
    for ln, line in enumerate(lines, 1):
        if lang:
            if line == "```":
                out.append((lang, start, "".join(f" {p}" for p in parts)))
                lang = None
            else:
                parts.append(line)
            continue
        for kind in ("promql", "logql"):
            if line == f"```{kind} {QUERY_TAG}":
                lang, start, parts = kind, ln, []
    if lang:
        out.append((lang, start, "".join(f" {p}" for p in parts)))
    return out


def balanced(expr):
    """( ) { } [ ] pair up in count and the double quotes are even."""
    pairs = all(expr.count(o) == expr.count(c) for o, c in ("()", "{}", "[]"))
    return pairs and expr.count('"') % 2 == 0


def query_block_misses(lang, expr):
    """What a tagged block lacks to select one environment and one provider."""
    norm = WHITESPACE.sub(" ", expr)
    if lang == "logql":
        return [f"missing {w}" for w in LOGQL_FILTERS if w not in norm]
    rpc_count = re.compile(r"rpc_server_duration_milliseconds_count")
    target_info = re.compile(r"target_info")
    rows = selector_lacks(rpc_count, 'deployment_environment="staging"', expr)
    rows += selector_lacks(target_info, 'deployment_environment="staging"', expr)
    rows += selector_lacks(target_info, 'host_provider="homelab"', expr)
    return rows + [f"missing {w}" for w in PROMQL_JOIN if w not in norm]


def metric_identifiers(expr):
    """PromQL metric identifiers in an expr: what is left once strings, matchers and functions are removed."""
    s = QUOTED.sub("", expr)
    if LABEL_VALUES.match(s):
        s = LABEL_VALUES_ARGS.sub(")", s, count=1)
    for pattern in (PIPE_STAGE, BRACES, BRACKETS, GROUPING):
        s = pattern.sub("", s)
    out = []
    for m in IDENTIFIER.finditer(s):
        if not CALL.match(s[m.end() :]) and m.group(0) not in PROMQL_KEYWORDS:
            out.append(m.group(0))
    return out


def alert_exprs(lines):
    """[(line number, expr)] for every `expr:` in a rules file; a block scalar is joined onto one line."""
    out, block_indent, start, parts = [], None, 0, []

    def flush():
        if parts:
            out.append((start, "".join(f" {p}" for p in parts)))
        parts.clear()

    for ln, line in enumerate(lines, 1):
        if block_indent is not None:
            if BLANK.match(line):
                continue
            if LEADING_SPACE.match(line).end() > block_indent:
                parts.append(line.lstrip(" \t\r\v\f"))
                continue
            flush()
            block_indent = None
        block, inline = EXPR_BLOCK.match(line), EXPR_INLINE.match(line)
        if block:
            block_indent, start = len(block.group(1)), ln
        elif inline:
            out.append((ln, EXPR_QUOTES.sub("", inline.group(1))))
    flush()
    return out


def alert_rules(lines):
    """[(line number, uid, noDataState, muted)] for every rule in alert-rules.yaml."""
    out, current = [], None
    for ln, line in enumerate(lines, 1):
        uid = UID_LINE.match(line)
        if uid:
            current = [ln, SPACE_OR_QUOTE.sub("", uid.group(1)), "", False]
            out.append(current)
            continue
        if current is None or not current[1]:
            continue
        nodata = NODATA_LINE.match(line)
        if nodata:
            current[2] = SPACE_OR_QUOTE.sub("", nodata.group(1))
        if MUTED_LABEL.match(line):
            current[3] = True
    return [tuple(rule) for rule in out if rule[1]]


def count_claims(lowered):
    """'<n> dashboards' / '<n> alert rules' claims in a lower-cased line, e.g. 'four alert rules'."""
    out = []
    while True:
        m = COUNT_CLAIM.search(lowered)
        if not m:
            return out
        out.append(m.group(0)[len(m.group(1)) :])
        lowered = lowered[m.end() :]


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    default_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    hits = Guard(argv[0].rstrip("/") if argv and argv[0] else default_root).run()
    for line in hits:
        sys.stderr.buffer.write((line + "\n").encode("utf-8", errors="surrogateescape"))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
