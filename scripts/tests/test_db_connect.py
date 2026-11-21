"""Tests for scripts/db-connect.py with stub doctl/psql/curl/sleep; no cluster, firewall or database is touched."""

import pytest
from conftest import load_script
from stub_tools import Stubs

SCRIPT = "db-connect.py"
db_connect = load_script(SCRIPT)

CLUSTER = db_connect.DEFAULT_CLUSTER_ID
PASSWORD = "p@ss:w/rd"
# Each doctl subcommand exits with $FAIL_<NAME> when that is set; a removed rule is no longer listed.
DOCTL = (
    'case "$*" in\n'
    '  *"firewalls list"*) [ -n "$FAIL_LIST" ] && exit "$FAIL_LIST"\n'
    '    echo "uuid-0 app abc"; [ -e "$STUB_LOG.removed" ] || echo "uuid-1 ip_addr 1.2.3.4";;\n'
    '  *"firewalls append"*) echo "appended"; exit "${FAIL_APPEND:-0}";;\n'
    '  *"firewalls remove"*) [ -n "$FAIL_REMOVE" ] && exit "$FAIL_REMOVE"\n'
    '    echo "removed"; : >"$STUB_LOG.removed";;\n'
    f'  *"databases connection"*) printf "${{CONNECTION-db.host 25060 doadmin  {PASSWORD}  \\n}}";;\n'
    "esac"
)
PSQL = (
    'echo "psql env PGPASSWORD=$PGPASSWORD PGSSLMODE=$PGSSLMODE" >>"$STUB_LOG"\n'
    '[ -n "$PSQL_SIGNAL" ] && kill "-$PSQL_SIGNAL" "$PPID"\n'
    'exit "${PSQL_STATUS:-0}"'
)
APPEND = f"doctl databases firewalls append {CLUSTER} --rule ip_addr:1.2.3.4"
LIST = f"doctl databases firewalls list {CLUSTER} --format UUID,Type,Value --no-header"
REMOVE = f"doctl databases firewalls remove {CLUSTER} --uuid uuid-1"
CONNECTION = (
    f"doctl databases connection {CLUSTER} --format Host,Port,User,Password --no-header"
)
REMOVED = "Removing firewall rule for 1.2.3.4 (uuid-1)...\nFirewall rule removed.\n"
OPENING = (
    "Using IP: 1.2.3.4\n"
    f"Appending firewall rule ip_addr:1.2.3.4 to cluster {CLUSTER}...\n"
)


@pytest.fixture
def stubs(tmp_path):
    stubs = Stubs(tmp_path)
    stubs.add("doctl", DOCTL)
    stubs.add("psql", PSQL)
    stubs.add("curl", 'echo 1.2.3.4\nexit "${CURL_STATUS:-0}"')
    stubs.add("sleep", 'exit "${SLEEP_STATUS:-0}"')
    return stubs


def test_session_appends_the_detected_ip_connects_and_removes_the_rule(stubs):
    proc = stubs.run(SCRIPT)
    assert (proc.returncode, proc.stderr) == (0, "")
    assert proc.stdout == (
        OPENING + "Connecting to defaultdb on db.host:25060 as doadmin ...\n" + REMOVED
    )
    assert stubs.calls() == [
        "curl -fsS https://api.ipify.org",
        APPEND,
        "sleep 5",
        CONNECTION,
        "psql -h db.host -p 25060 -U doadmin -d defaultdb",
        f"psql env PGPASSWORD={PASSWORD} PGSSLMODE=require",
        LIST,
        REMOVE,
    ]


def test_password_reaches_psql_only_through_the_environment(stubs):
    proc = stubs.run(SCRIPT)
    assert PASSWORD not in proc.stdout + proc.stderr
    assert [c for c in stubs.calls() if PASSWORD in c] == [
        f"psql env PGPASSWORD={PASSWORD} PGSSLMODE=require"
    ]


def test_flags_and_extra_psql_args_and_psql_status(stubs):
    proc = stubs.run(
        SCRIPT,
        *("--cluster", "CL", "-d", "staging", "-i", "9.9.9.9"),
        *("--", "-c", "select 1;", "-d"),
        env={"PSQL_STATUS": "2", "DB_NAME": "ignored"},
    )
    assert proc.returncode == 2
    assert proc.stdout == (
        "Using IP: 9.9.9.9\n"
        "Appending firewall rule ip_addr:9.9.9.9 to cluster CL...\n"
        "Connecting to staging on db.host:25060 as doadmin ...\n"
    )
    calls = stubs.calls()
    assert "curl -fsS https://api.ipify.org" not in calls
    assert "psql -h db.host -p 25060 -U doadmin -d staging -c select 1; -d" in calls
    assert calls[-1] == (
        "doctl databases firewalls list CL --format UUID,Type,Value --no-header"
    )


def test_environment_supplies_the_defaults(stubs):
    proc = stubs.run(
        SCRIPT, env={"DB_CLUSTER_ID": "ENVCL", "DB_NAME": "envdb", "DB_IP": "1.2.3.4"}
    )
    assert proc.returncode == 0
    assert "Connecting to envdb on db.host:25060 as doadmin ...\n" in proc.stdout
    assert stubs.calls()[0] == (
        "doctl databases firewalls append ENVCL --rule ip_addr:1.2.3.4"
    )


@pytest.mark.parametrize("tool", ["doctl", "psql", "curl"])
def test_missing_tool_exits_1_before_touching_the_firewall(stubs, tool):
    (stubs.bin / tool).unlink()
    proc = stubs.run(SCRIPT)
    assert (proc.returncode, proc.stdout) == (1, "")
    assert proc.stderr == f"error: '{tool}' not found in PATH\n"
    assert stubs.calls() == []


def test_undetectable_ip_exits_1(stubs):
    proc = stubs.run(SCRIPT, env={"CURL_STATUS": "6"})
    assert (proc.returncode, proc.stdout) == (1, "")
    assert proc.stderr == "error: could not detect public IP\n"
    assert stubs.calls() == ["curl -fsS https://api.ipify.org"]


def test_failed_append_exits_with_its_status_and_removes_nothing(stubs):
    proc = stubs.run(SCRIPT, env={"FAIL_APPEND": "4"})
    assert proc.returncode == 4
    assert proc.stdout == OPENING
    assert stubs.calls()[-1] == APPEND


@pytest.mark.parametrize("connection", ["", "db.host 25060 doadmin secret"])
def test_unterminated_connection_details_exit_1_after_cleanup(stubs, connection):
    proc = stubs.run(SCRIPT, env={"CONNECTION": connection})
    assert proc.returncode == 1
    assert proc.stdout == OPENING + REMOVED
    assert stubs.calls()[-3:] == [CONNECTION, LIST, REMOVE]


def test_failed_sleep_exits_with_its_status_after_cleanup(stubs):
    proc = stubs.run(SCRIPT, env={"SLEEP_STATUS": "130"})
    assert proc.returncode == 130
    assert stubs.calls()[-3:] == ["sleep 5", LIST, REMOVE]


def test_failed_cleanup_lookup_replaces_the_exit_status(stubs):
    proc = stubs.run(SCRIPT, env={"FAIL_LIST": "3", "PSQL_STATUS": "7"})
    assert (proc.returncode, proc.stderr) == (3, "")
    assert "Removing" not in proc.stdout
    assert stubs.calls()[-1] == LIST


def test_failed_removal_warns_and_keeps_the_psql_status(stubs):
    proc = stubs.run(SCRIPT, env={"FAIL_REMOVE": "3", "PSQL_STATUS": "7"})
    assert proc.returncode == 7
    assert proc.stdout.endswith("Removing firewall rule for 1.2.3.4 (uuid-1)...\n")
    assert proc.stderr == (
        "WARNING: failed to remove rule uuid-1 — remove it manually in the DO dashboard.\n"
    )


def test_no_rule_for_this_ip_removes_nothing(stubs):
    proc = stubs.run(SCRIPT, "-i", "8.8.8.8")
    assert proc.returncode == 0
    assert "Removing" not in proc.stdout
    assert stubs.calls()[-1] == LIST


@pytest.mark.parametrize("signame", ["INT", "TERM"])
def test_signal_during_psql_cleans_up_once_psql_returns(stubs, signame):
    proc = stubs.run(SCRIPT, env={"PSQL_SIGNAL": signame, "PSQL_STATUS": "3"})
    assert proc.returncode == 3
    assert proc.stdout.endswith(REMOVED)
    assert stubs.calls()[-3:] == [LIST, REMOVE, LIST]


def test_unknown_option_exits_1(stubs):
    proc = stubs.run(SCRIPT, "-d", "x", "--nope")
    assert (proc.returncode, proc.stdout) == (1, "")
    assert proc.stderr == "unknown option: --nope\n"
    assert stubs.calls() == []


def test_option_without_a_value_exits_1(stubs):
    proc = stubs.run(SCRIPT, "-c")
    assert (proc.returncode, proc.stdout) == (1, "")
    assert proc.stderr.endswith("db-connect.py: $2: unbound variable\n")


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_help_prints_the_header_and_exits_0(stubs, flag):
    proc = stubs.run(SCRIPT, "-d", "x", flag)
    assert proc.returncode == 0
    assert proc.stdout == db_connect.HELP + "\n"
    assert stubs.calls() == []


def test_parse_args_precedence():
    env = {"DB_CLUSTER_ID": "", "DB_NAME": "envdb", "DB_IP": "1.1.1.1"}
    assert db_connect.parse_args([], env) == {
        "cluster": CLUSTER,
        "db": "envdb",
        "ip": "1.1.1.1",
        "psql_args": [],
    }
    assert db_connect.parse_args(
        ["--ip", "", "--db", "d", "--", "-c", "--", "x"], env
    ) == {
        "cluster": CLUSTER,
        "db": "d",
        "ip": "",
        "psql_args": ["-c", "--", "x"],
    }


def test_rule_uuid_matches_only_an_ip_addr_rule_for_this_ip():
    listing = "u0 app 1.2.3.4\nu1 ip_addr 1.2.3.40\n\nu2\tip_addr\t1.2.3.4\nu3 ip_addr 1.2.3.4\n"
    assert db_connect.rule_uuid(listing, "1.2.3.4") == "u2"
    assert db_connect.rule_uuid(listing, "9.9.9.9") == ""


@pytest.mark.parametrize(
    ("output", "fields"),
    [
        ("h 1 u pw\n", ["h", "1", "u", "pw"]),
        ("  h\t1 u  p w  \nsecond line\n", ["h", "1", "u", "p w"]),
        ("h 1\n", ["h", "1", "", ""]),
        ("\n", ["", "", "", ""]),
        ("h 1 u pw", None),
        ("", None),
    ],
)
def test_connection_fields_split_like_read(output, fields):
    assert db_connect.connection_fields(output) == fields


def test_exit_status_maps_a_signal_death_like_the_shell():
    assert db_connect.exit_status(2) == 2
    assert db_connect.exit_status(-2) == 130
