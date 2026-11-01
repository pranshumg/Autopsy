import pathlib
import re

from autopsy.memory import SQLiteMemory

ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_agents_never_touch_ground_truth_or_target_code():
    """Agents reach targets over HTTP only: no imports of targets/, no hidden_rules, no /reveal."""
    for path in (ROOT / "autopsy" / "agents").glob("*.py"):
        src = path.read_text()
        assert "hidden_rules" not in src, path
        assert not re.search(r"^\s*(from|import)\s+targets", src, re.M), path
        assert "/reveal" not in src and "scorecard" not in src, path
    for name in ("orchestrator.py", "stats.py", "causal.py", "probes.py", "memory.py"):
        src = (ROOT / "autopsy" / name).read_text()
        assert "hidden_rules" not in src and "/reveal" not in src, name


def test_sqlite_memory_blackboard_roundtrip(tmp_path):
    m = SQLiteMemory("t1", str(tmp_path / "m.db"))
    m.write_fact("noise", {"sd": 1.5}, "statistician")
    a = m.post_message({"from": "statistician", "to": "experimenter", "type": "probe", "content": {"feature": "age"}, "reason": "CI too wide"})
    m.post_message({"from": "experimenter", "to": "statistician", "type": "probe_data", "content": {}, "reason": ""})
    assert m.read_fact("noise") == {"sd": 1.5}
    assert [x["type"] for x in m.read_messages(to="experimenter")] == ["probe"]
    assert m.next_open()["id"] == a["id"]
    m.resolve(a["id"])
    assert m.next_open()["type"] == "probe_data"
    # runs are isolated
    assert SQLiteMemory("t2", str(tmp_path / "m.db")).read_facts() == {}
