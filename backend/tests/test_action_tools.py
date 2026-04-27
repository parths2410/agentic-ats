from app.tools import action_tools
from app.tools.data_tools import get_ui_state


def test_set_highlights_persists_and_returns_mutation(db, role):
    out = action_tools.set_highlights(db, role.id, {"candidate_ids": ["c1", "c2"]})
    assert out["mutation"] == {"type": "set_highlights", "ids": ["c1", "c2"]}
    assert out["ui_state"]["highlighted_candidate_ids"] == ["c1", "c2"]


def test_set_highlights_replaces_previous_set(db, role):
    action_tools.set_highlights(db, role.id, {"candidate_ids": ["a"]})
    out = action_tools.set_highlights(db, role.id, {"candidate_ids": ["b"]})
    assert out["ui_state"]["highlighted_candidate_ids"] == ["b"]


def test_set_highlights_with_empty_list_clears(db, role):
    action_tools.set_highlights(db, role.id, {"candidate_ids": ["a", "b"]})
    out = action_tools.set_highlights(db, role.id, {"candidate_ids": []})
    assert out["ui_state"]["highlighted_candidate_ids"] == []


def test_set_highlights_filters_falsy_ids(db, role):
    out = action_tools.set_highlights(
        db, role.id, {"candidate_ids": ["x", "", None, "y"]}
    )
    assert out["ui_state"]["highlighted_candidate_ids"] == ["x", "y"]


def test_remove_highlights(db, role):
    action_tools.set_highlights(db, role.id, {"candidate_ids": ["a", "b", "c"]})
    out = action_tools.remove_highlights(db, role.id, {"candidate_ids": ["b"]})
    assert out["ui_state"]["highlighted_candidate_ids"] == ["a", "c"]
    assert out["mutation"] == {"type": "remove_highlights", "ids": ["b"]}


def test_clear_highlights(db, role):
    action_tools.set_highlights(db, role.id, {"candidate_ids": ["a"]})
    out = action_tools.clear_highlights(db, role.id, {})
    assert out["ui_state"]["highlighted_candidate_ids"] == []
    assert out["mutation"] == {"type": "clear_highlights"}


def test_set_sort_records_field_and_order(db, role):
    out = action_tools.set_sort(db, role.id, {"field": "Python", "order": "asc"})
    assert out["mutation"] == {"type": "set_sort", "field": "Python", "order": "asc"}
    assert out["ui_state"]["current_sort_field"] == "Python"
    assert out["ui_state"]["current_sort_order"] == "asc"


def test_set_sort_defaults_to_desc_for_invalid_order(db, role):
    out = action_tools.set_sort(db, role.id, {"field": "Python", "order": "sideways"})
    assert out["mutation"]["order"] == "desc"


def test_set_sort_requires_field(db, role):
    out = action_tools.set_sort(db, role.id, {})
    assert "error" in out


def test_reset_ui_clears_everything(db, role):
    action_tools.set_highlights(db, role.id, {"candidate_ids": ["a"]})
    action_tools.set_sort(db, role.id, {"field": "Python", "order": "asc"})
    out = action_tools.reset_ui(db, role.id, {})
    assert out["ui_state"]["highlighted_candidate_ids"] == []
    assert out["ui_state"]["current_sort_field"] is None
    assert out["mutation"] == {"type": "reset_ui"}


def test_get_ui_state_now_reads_real_state(db, role):
    action_tools.set_highlights(db, role.id, {"candidate_ids": ["a"]})
    state = get_ui_state(db, role.id, {})
    assert state["highlighted_candidate_ids"] == ["a"]
