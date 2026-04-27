"""Anthropic-format tool definitions for the agentic chat loop.

Each tool definition has `name`, `description`, and `input_schema` (JSON
Schema). The chat service forwards these to the LLM provider, which forwards
them to the Anthropic API; the LLM picks tools by name and emits arguments
matching the schema.

Keep descriptions tight and instructive — the LLM's tool-selection accuracy
is largely a function of how well the descriptions explain *when* to use
each tool.
"""

from __future__ import annotations

from typing import Any

# ---- Data retrieval tools (read-only) ---------------------------------------

GET_CANDIDATES: dict[str, Any] = {
    "name": "get_candidates",
    "description": (
        "List candidates for the current role, ranked by aggregate score by "
        "default. Use this for high-level overviews, top-N requests, or as a "
        "first step before drilling into a specific candidate."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 200,
                "default": 50,
                "description": "Max candidates to return.",
            },
            "offset": {
                "type": "integer",
                "minimum": 0,
                "default": 0,
                "description": "Pagination offset.",
            },
            "sort_by": {
                "type": "string",
                "default": "rank",
                "description": "Sort key: 'rank', 'name', 'aggregate_score', or a criterion name.",
            },
            "sort_order": {
                "type": "string",
                "enum": ["asc", "desc"],
                "default": "asc",
            },
        },
    },
}

GET_CANDIDATE_DETAIL: dict[str, Any] = {
    "name": "get_candidate_detail",
    "description": (
        "Return the full structured profile for a single candidate "
        "(experiences, education, skills, certifications, contact). Use when "
        "the user asks about one specific candidate's background."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_id": {"type": "string"},
        },
        "required": ["candidate_id"],
    },
}

GET_CANDIDATE_RAW_TEXT: dict[str, Any] = {
    "name": "get_candidate_raw_text",
    "description": (
        "Return the full raw extracted resume text for a candidate. Use when "
        "the structured profile may miss nuance — e.g., deep dives, quotes, "
        "specific phrasing, or when the user asks about something not in the "
        "structured fields."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_id": {"type": "string"},
        },
        "required": ["candidate_id"],
    },
}

GET_CANDIDATE_SCORES: dict[str, Any] = {
    "name": "get_candidate_scores",
    "description": (
        "Return per-criterion scores and rationales for a candidate, plus the "
        "weighted aggregate. Use when the user asks why a candidate ranks "
        "where they do, or wants the score breakdown."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_id": {"type": "string"},
        },
        "required": ["candidate_id"],
    },
}

SEARCH_CANDIDATES: dict[str, Any] = {
    "name": "search_candidates",
    "description": (
        "Find candidates whose profile matches a query in a given field. "
        "Field options: 'skills', 'companies', 'titles', 'education', "
        "'location', 'text' (full-text over the raw resume). Returns matches "
        "with short excerpts."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "field": {
                "type": "string",
                "enum": ["skills", "companies", "titles", "education", "location", "text"],
            },
            "query": {"type": "string", "minLength": 1},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
        "required": ["field", "query"],
    },
}

COMPUTE_STATS: dict[str, Any] = {
    "name": "compute_stats",
    "description": (
        "Compute aggregate statistics over the candidate pool. stat_type: "
        "'count' (total candidates, optionally filtered), 'percentage' "
        "(fraction matching a condition), 'average' (mean of a numeric "
        "field), 'distribution' (counts grouped by field value). Always "
        "prefer this over fetching all candidates and counting."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "stat_type": {
                "type": "string",
                "enum": ["count", "percentage", "average", "distribution"],
            },
            "field": {
                "type": "string",
                "description": (
                    "Field to compute over: 'skills', 'titles', 'companies', "
                    "'education', 'location', 'aggregate_score', or a criterion name."
                ),
            },
            "condition": {
                "type": "string",
                "description": (
                    "Optional substring filter, e.g. 'Python', 'Senior', 'California'. "
                    "Required for 'percentage'."
                ),
            },
        },
        "required": ["stat_type", "field"],
    },
}

GET_UI_STATE: dict[str, Any] = {
    "name": "get_ui_state",
    "description": (
        "Return the current UI state (which candidates are highlighted, the "
        "active sort). Call this before chaining filters ('from those, who…') "
        "so you can intersect with the existing highlight set."
    ),
    "input_schema": {"type": "object", "properties": {}},
}


DATA_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    GET_CANDIDATES,
    GET_CANDIDATE_DETAIL,
    GET_CANDIDATE_RAW_TEXT,
    GET_CANDIDATE_SCORES,
    SEARCH_CANDIDATES,
    COMPUTE_STATS,
    GET_UI_STATE,
]


# ---- Action tools (mutate UI state) -----------------------------------------


SET_HIGHLIGHTS: dict[str, Any] = {
    "name": "set_highlights",
    "description": (
        "Replace the highlighted-candidates set with exactly these IDs. This is "
        "the single source of truth for what is highlighted right now — calling "
        "it does NOT add to the existing set, it overwrites it. Use this for any "
        "filter/highlight/shortlist request. For filter chaining ('from those…'), "
        "first call get_ui_state to read the current highlight set, then intersect "
        "with your new search results, then call set_highlights with that "
        "intersection. To clear all highlights, call clear_highlights instead. "
        "Never claim to remove or hide candidates — only highlight matches. "
        "IMPORTANT: pass the candidate's `id` field from get_candidates (a UUID "
        "string like 'd91eebc3-de25-…'), NOT the `rank` integer."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "The complete list of candidate UUIDs (from the `id` field "
                    "of get_candidates) that should be highlighted after this "
                    "call. Do NOT pass rank numbers."
                ),
            },
        },
        "required": ["candidate_ids"],
    },
}

REMOVE_HIGHLIGHTS: dict[str, Any] = {
    "name": "remove_highlights",
    "description": (
        "Un-highlight specific candidates. Used to refine an existing highlight "
        "set. Pass candidate UUIDs (the `id` field from get_candidates), not "
        "rank numbers."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["candidate_ids"],
    },
}

CLEAR_HIGHLIGHTS: dict[str, Any] = {
    "name": "clear_highlights",
    "description": "Remove all highlights. Useful when starting a brand-new filter.",
    "input_schema": {"type": "object", "properties": {}},
}

SET_SORT: dict[str, Any] = {
    "name": "set_sort",
    "description": (
        "Re-sort the candidate list. `field` may be 'aggregate' for the weighted "
        "aggregate score, or any criterion name to sort by that criterion's score."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "field": {"type": "string"},
            "order": {"type": "string", "enum": ["asc", "desc"], "default": "desc"},
        },
        "required": ["field"],
    },
}

RESET_UI: dict[str, Any] = {
    "name": "reset_ui",
    "description": "Restore the original ranking and clear all highlights.",
    "input_schema": {"type": "object", "properties": {}},
}


ACTION_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    SET_HIGHLIGHTS,
    REMOVE_HIGHLIGHTS,
    CLEAR_HIGHLIGHTS,
    SET_SORT,
    RESET_UI,
]


# Names that ChatService treats as action tools (they may produce mutations).
ACTION_TOOL_NAMES: frozenset[str] = frozenset(
    d["name"] for d in ACTION_TOOL_DEFINITIONS
)


def all_definitions() -> list[dict[str, Any]]:
    """Return every tool definition the chat loop should expose."""
    return list(DATA_TOOL_DEFINITIONS) + list(ACTION_TOOL_DEFINITIONS)
