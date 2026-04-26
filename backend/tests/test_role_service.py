import pytest

from app.schemas.role import RoleCreate, RoleUpdate
from app.services.role_service import RoleNotFound, RoleService


def test_create_and_get(db):
    svc = RoleService(db)
    role = svc.create(RoleCreate(title="  Eng ", job_description="Build."))
    assert role.title == "Eng"
    assert role.job_description == "Build."
    fetched = svc.get(role.id)
    assert fetched.id == role.id


def test_get_unknown_raises(db):
    with pytest.raises(RoleNotFound):
        RoleService(db).get("missing")


def test_update_partial_fields(db):
    svc = RoleService(db)
    role = svc.create(RoleCreate(title="A", job_description="x"))
    updated = svc.update(role.id, RoleUpdate(title="B"))
    assert updated.title == "B"
    assert updated.job_description == "x"
    updated2 = svc.update(role.id, RoleUpdate(job_description="y"))
    assert updated2.job_description == "y"


def test_update_unknown_raises(db):
    with pytest.raises(RoleNotFound):
        RoleService(db).update("nope", RoleUpdate(title="x"))


def test_delete(db):
    svc = RoleService(db)
    role = svc.create(RoleCreate(title="Z"))
    svc.delete(role.id)
    with pytest.raises(RoleNotFound):
        svc.get(role.id)


def test_delete_unknown(db):
    with pytest.raises(RoleNotFound):
        RoleService(db).delete("nope")


def test_list_with_counts(db, role, criteria, candidates):
    rows = RoleService(db).list_with_counts()
    assert len(rows) == 1
    fetched_role, cand_count, crit_count = rows[0]
    assert fetched_role.id == role.id
    assert cand_count == 3
    assert crit_count == 2


def test_list_with_counts_empty_role(db):
    svc = RoleService(db)
    svc.create(RoleCreate(title="Empty"))
    rows = svc.list_with_counts()
    assert rows[0][1] == 0  # candidate_count
    assert rows[0][2] == 0  # criteria_count
