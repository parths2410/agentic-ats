from app.services.ui_state_service import UIStateService


def test_get_or_create_seeds_empty_state(db, role):
    svc = UIStateService(db)
    row = svc.get_or_create(role.id)
    assert row.highlighted_candidate_ids == []
    assert row.sort_field is None and row.sort_order is None


def test_add_highlights_dedupes_and_preserves_order(db, role):
    svc = UIStateService(db)
    row = svc.add_highlights(role.id, ["c1", "c2", "c1"])
    assert row.highlighted_candidate_ids == ["c1", "c2"]
    row2 = svc.add_highlights(role.id, ["c3", "c2"])
    assert row2.highlighted_candidate_ids == ["c1", "c2", "c3"]


def test_remove_highlights(db, role):
    svc = UIStateService(db)
    svc.add_highlights(role.id, ["a", "b", "c"])
    row = svc.remove_highlights(role.id, ["b", "z"])
    assert row.highlighted_candidate_ids == ["a", "c"]


def test_replace_highlights_dedupes(db, role):
    svc = UIStateService(db)
    svc.add_highlights(role.id, ["a"])
    row = svc.replace_highlights(role.id, ["x", "y", "x"])
    assert row.highlighted_candidate_ids == ["x", "y"]


def test_clear_highlights(db, role):
    svc = UIStateService(db)
    svc.add_highlights(role.id, ["a", "b"])
    row = svc.clear_highlights(role.id)
    assert row.highlighted_candidate_ids == []


def test_set_sort_records_field_and_order(db, role):
    svc = UIStateService(db)
    row = svc.set_sort(role.id, "Python", "asc")
    assert row.sort_field == "Python" and row.sort_order == "asc"


def test_reset_clears_everything(db, role):
    svc = UIStateService(db)
    svc.add_highlights(role.id, ["a"])
    svc.set_sort(role.id, "Python", "desc")
    row = svc.reset(role.id)
    assert row.highlighted_candidate_ids == [] and row.sort_field is None and row.sort_order is None


def test_to_dict_shape(db, role):
    svc = UIStateService(db)
    row = svc.set_sort(role.id, "f", "desc")
    out = svc.to_dict(row)
    assert out == {
        "role_id": role.id,
        "highlighted_candidate_ids": [],
        "current_sort_field": "f",
        "current_sort_order": "desc",
    }
