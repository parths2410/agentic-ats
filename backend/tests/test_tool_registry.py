import pytest

from app.tools.registry import ToolRegistry, UnknownToolError, default_registry


def test_default_registry_exposes_all_data_tools():
    reg = default_registry()
    names = set(reg.names())
    assert {
        "get_candidates",
        "get_candidate_detail",
        "get_candidate_raw_text",
        "get_candidate_scores",
        "search_candidates",
        "compute_stats",
        "get_ui_state",
    } <= names


def test_definitions_are_independent_copies():
    reg = default_registry()
    a = reg.definitions()
    a.append({"name": "foo"})
    assert "foo" not in reg.names()


def test_execute_routes_to_executor(db, role):
    calls: list[tuple[str, dict]] = []

    def fake_get_candidates(_db, role_id, args):
        calls.append((role_id, args))
        return {"candidates": []}

    reg = ToolRegistry(executors={"get_candidates": fake_get_candidates})
    out = reg.execute("get_candidates", {"limit": 5}, db, role.id)
    assert out == {"candidates": []}
    assert calls == [(role.id, {"limit": 5})]


def test_execute_unknown_tool_raises(db, role):
    reg = ToolRegistry(executors={})
    with pytest.raises(UnknownToolError):
        reg.execute("does_not_exist", {}, db, role.id)


def test_execute_handles_none_args(db, role):
    def fake(_db, _role_id, args):
        assert args == {}
        return {"ok": True}

    reg = ToolRegistry(executors={"fake": fake})
    assert reg.execute("fake", None, db, role.id) == {"ok": True}


def test_register_adds_definition_and_executor():
    reg = ToolRegistry(executors={}, definitions=[])
    reg.register({"name": "noop", "description": "x", "input_schema": {}}, lambda *a: {})
    assert "noop" in reg.names()
