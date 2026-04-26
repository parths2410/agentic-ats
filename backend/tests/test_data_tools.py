from app.tools import data_tools


def test_get_candidates_default_returns_all_sorted_by_rank(db, role, candidates):
    out = data_tools.get_candidates(db, role.id, {})
    assert out["total"] == 3
    # rank 1, rank 2, then the unranked pending one
    names = [c["name"] for c in out["candidates"]]
    assert names[:2] == ["Ada Lovelace", "Grace Hopper"]
    assert out["candidates"][0]["rank"] == 1


def test_get_candidates_sort_by_aggregate_desc(db, role, candidates):
    out = data_tools.get_candidates(
        db, role.id, {"sort_by": "aggregate_score", "sort_order": "desc"}
    )
    scores = [c["aggregate_score"] for c in out["candidates"]]
    # None ends up last because of (is_none, -score) tuple
    assert scores[0] == 8.5
    assert scores[1] == 6.0
    assert scores[2] is None


def test_get_candidates_sort_by_name_and_pagination(db, role, candidates):
    out = data_tools.get_candidates(
        db, role.id, {"sort_by": "name", "sort_order": "asc", "limit": 1, "offset": 1}
    )
    assert out["returned"] == 1
    assert out["candidates"][0]["name"] == "Grace Hopper"


def test_get_candidates_sort_by_criterion_name(db, role, candidates):
    out = data_tools.get_candidates(
        db, role.id, {"sort_by": "Python", "sort_order": "desc"}
    )
    # Ada (9.0) before Grace (4.0); pending has no Python score so last
    names = [c["name"] for c in out["candidates"]]
    assert names[0] == "Ada Lovelace"
    assert names[1] == "Grace Hopper"


def test_get_candidate_detail_happy(db, role, candidates):
    ada = candidates[0]
    out = data_tools.get_candidate_detail(db, role.id, {"candidate_id": ada.id})
    assert out["name"] == "Ada Lovelace"
    assert out["structured_profile"]["skills"] == ["Python", "Postgres"]


def test_get_candidate_detail_missing_returns_error(db, role):
    out = data_tools.get_candidate_detail(db, role.id, {"candidate_id": "nope"})
    assert out["error"] == "candidate_not_found"


def test_get_candidate_detail_wrong_role(db, role, candidates):
    out = data_tools.get_candidate_detail(db, "other-role", {"candidate_id": candidates[0].id})
    assert out["error"] == "candidate_not_found"


def test_get_candidate_raw_text(db, role, candidates):
    out = data_tools.get_candidate_raw_text(
        db, role.id, {"candidate_id": candidates[0].id}
    )
    assert "Python guru" in out["raw_text"]


def test_get_candidate_raw_text_missing(db, role):
    out = data_tools.get_candidate_raw_text(db, role.id, {"candidate_id": "x"})
    assert out["error"] == "candidate_not_found"


def test_get_candidate_scores_returns_per_criterion(db, role, candidates):
    out = data_tools.get_candidate_scores(
        db, role.id, {"candidate_id": candidates[0].id}
    )
    names = {s["criterion_name"] for s in out["scores"]}
    assert names == {"Python", "Leadership"}
    assert out["aggregate_score"] == 8.5


def test_get_candidate_scores_missing(db, role):
    out = data_tools.get_candidate_scores(db, role.id, {"candidate_id": "no"})
    assert out["error"] == "candidate_not_found"


def test_search_candidates_skills_match(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "skills", "query": "Python"}
    )
    names = {m["name"] for m in out["matches"]}
    assert names == {"Ada Lovelace"}
    assert out["match_count"] == 1


def test_search_candidates_text_field_with_excerpt(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "text", "query": "compilers"}
    )
    assert out["match_count"] == 1
    excerpt = out["matches"][0]["excerpt"]
    assert "compilers" in excerpt.lower()


def test_search_candidates_location(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "location", "query": "California"}
    )
    assert {m["name"] for m in out["matches"]} == {"Ada Lovelace"}


def test_search_candidates_companies(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "companies", "query": "Google"}
    )
    assert {m["name"] for m in out["matches"]} == {"Ada Lovelace"}


def test_search_candidates_titles(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "titles", "query": "Engineer"}
    )
    # Both Ada (Staff Engineer) and Grace (Engineer) match
    assert {m["name"] for m in out["matches"]} == {"Ada Lovelace", "Grace Hopper"}


def test_search_candidates_education(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "education", "query": "Berkeley"}
    )
    assert {m["name"] for m in out["matches"]} == {"Ada Lovelace"}


def test_search_candidates_validates_inputs(db, role):
    out = data_tools.search_candidates(db, role.id, {"field": "", "query": ""})
    assert "error" in out
    assert out["matches"] == []


def test_search_candidates_unknown_field_returns_no_matches(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "unknown", "query": "x"}
    )
    assert out["match_count"] == 0


def test_search_candidates_respects_limit(db, role, candidates):
    out = data_tools.search_candidates(
        db, role.id, {"field": "titles", "query": "Engineer", "limit": 1}
    )
    assert out["match_count"] == 1


def test_compute_stats_count(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "count", "field": "skills", "condition": "Python"}
    )
    assert out["value"] == 1
    assert out["total_candidates"] == 3


def test_compute_stats_count_no_condition_counts_all(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "count", "field": "skills"}
    )
    assert out["value"] == 3


def test_compute_stats_percentage(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id,
        {"stat_type": "percentage", "field": "location", "condition": "California"},
    )
    assert out["matched"] == 1
    assert out["total"] == 3
    assert out["value"] == round(100.0 / 3, 2)


def test_compute_stats_percentage_requires_condition(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "percentage", "field": "skills"}
    )
    assert "error" in out


def test_compute_stats_average_aggregate(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "average", "field": "aggregate_score"}
    )
    assert out["n"] == 2
    assert out["value"] == round((8.5 + 6.0) / 2, 2)


def test_compute_stats_average_per_criterion(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "average", "field": "Python"}
    )
    assert out["n"] == 2
    assert out["value"] == round((9.0 + 4.0) / 2, 2)


def test_compute_stats_average_no_data(db, role):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "average", "field": "aggregate_score"}
    )
    assert out["value"] is None and out["n"] == 0


def test_compute_stats_distribution(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "distribution", "field": "skills"}
    )
    assert out["unique_values"] >= 2
    bucket_keys = {b["value"] for b in out["buckets"]}
    assert {"Python", "Postgres", "COBOL"} <= bucket_keys


def test_compute_stats_unknown_type(db, role, candidates):
    out = data_tools.compute_stats(
        db, role.id, {"stat_type": "median", "field": "skills"}
    )
    assert "error" in out


def test_compute_stats_percentage_with_no_candidates(db, role):
    out = data_tools.compute_stats(
        db, role.id,
        {"stat_type": "percentage", "field": "skills", "condition": "Python"},
    )
    assert out["total"] == 0
    assert out["value"] == 0.0


def test_get_ui_state_stub(db, role):
    out = data_tools.get_ui_state(db, role.id, {})
    assert out["highlighted_candidate_ids"] == []
    assert out["current_sort_field"] is None
    assert out["role_id"] == role.id
