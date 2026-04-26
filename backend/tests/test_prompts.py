"""The prompt templates are tiny — just verify their builders return the
expected text and embed the inputs."""

from app.llm.prompts.extract_criteria import (
    SYSTEM_PROMPT as EXTRACT_SYS,
    build_user_prompt as build_extract,
)
from app.llm.prompts.parse_resume import (
    SYSTEM_PROMPT as PARSE_SYS,
    build_user_prompt as build_parse,
)
from app.llm.prompts.score_candidate import (
    SYSTEM_PROMPT as SCORE_SYS,
    build_user_prompt as build_score,
)


def test_extract_user_prompt_includes_jd():
    out = build_extract("we need a python ninja")
    assert "python ninja" in out
    assert "JSON only" in out


def test_extract_system_prompt_mentions_weights():
    assert "1.0" in EXTRACT_SYS and "0.5" in EXTRACT_SYS


def test_parse_user_prompt_includes_text():
    raw = "Jane Doe — engineer at Foo"
    out = build_parse(raw)
    assert raw in out


def test_parse_system_describes_schema():
    assert "experiences" in PARSE_SYS and "confidence_scores" in PARSE_SYS


def test_score_user_prompt_includes_jd_and_criteria():
    crit = [{"name": "Python", "description": "py", "weight": 1.0}]
    profile = {"name": "X", "skills": ["Python"], "experiences": [], "education": []}
    out = build_score("the JD", crit, profile)
    assert "the JD" in out
    assert "Python" in out


def test_score_system_anchors_scale():
    assert "1-10" in SCORE_SYS or "1-2" in SCORE_SYS
