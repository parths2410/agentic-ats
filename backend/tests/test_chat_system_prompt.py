from app.llm.prompts.chat_system import build_system_prompt


def test_includes_role_title_and_jd():
    out = build_system_prompt(
        role_title="Backend Eng",
        job_description="Build APIs.",
        criteria=[],
        candidate_count=4,
    )
    assert "Backend Eng" in out
    assert "Build APIs." in out
    assert "4 applicants" in out


def test_renders_criteria_with_weights_and_description():
    out = build_system_prompt(
        "T", "JD",
        criteria=[
            {"name": "Python", "weight": 1.0, "description": "Py skill"},
            {"name": "Leadership", "weight": 0.5, "description": ""},
        ],
        candidate_count=0,
    )
    assert "Python (weight 1.0): Py skill" in out
    assert "Leadership (weight 0.5)" in out


def test_handles_empty_jd_and_criteria():
    out = build_system_prompt("T", "", [], 0)
    assert "no job description" in out
    assert "no criteria" in out


def test_includes_behavioral_rules_about_filter_chaining():
    out = build_system_prompt("T", "JD", [], 0)
    assert "get_ui_state" in out
    assert "filter chaining" in out.lower()
