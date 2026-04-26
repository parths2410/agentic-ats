from app.tools.definitions import (
    DATA_TOOL_DEFINITIONS,
    GET_CANDIDATES,
    SEARCH_CANDIDATES,
    all_definitions,
)


def test_each_definition_has_required_fields():
    for d in DATA_TOOL_DEFINITIONS:
        assert isinstance(d["name"], str) and d["name"]
        assert isinstance(d["description"], str) and len(d["description"]) > 20
        schema = d["input_schema"]
        assert schema["type"] == "object"
        assert "properties" in schema


def test_all_definitions_returns_a_copy():
    expected_names = {d["name"] for d in all_definitions()}
    a = all_definitions()
    a.append({"name": "x"})
    b = all_definitions()
    assert {d["name"] for d in b} == expected_names


def test_search_candidates_field_enum():
    enum = SEARCH_CANDIDATES["input_schema"]["properties"]["field"]["enum"]
    assert {"skills", "companies", "titles", "education", "location", "text"} <= set(enum)


def test_get_candidates_pagination_bounds():
    props = GET_CANDIDATES["input_schema"]["properties"]
    assert props["limit"]["minimum"] == 1
    assert props["limit"]["maximum"] >= 50
    assert props["offset"]["minimum"] == 0


def test_no_duplicate_names():
    names = [d["name"] for d in all_definitions()]
    assert len(names) == len(set(names))
