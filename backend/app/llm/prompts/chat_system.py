"""System prompt builder for the agentic chat loop.

The prompt provides role context (title, JD, criteria) and behavioral rules
about tool selection. It deliberately does NOT include candidate data — the
LLM must fetch that via tools, which keeps latency and token cost low for
small queries and lets the same prompt work as the candidate pool grows.
"""

from __future__ import annotations

from typing import Iterable


_BEHAVIOR_RULES = """Behavioral rules:
- When asked to highlight, filter, or shortlist candidates, call
  set_highlights with the matching candidate ids. Highlights are additive
  and "soft" — never claim to remove or hide candidates, only highlight
  matches.
- For filter chaining ("from those…", "of these…"), FIRST call get_ui_state
  to read the currently highlighted ids. Then run your new search. Then
  call set_highlights with the INTERSECTION of the existing highlights and
  the new matches. (If nothing is currently highlighted, treat the chain
  the same as a fresh filter.)
- For "remove from highlights" or "un-highlight" requests, use
  remove_highlights. To start over, use clear_highlights or reset_ui.
- For sort requests ("sort by X", "rank by X"), call set_sort. Use
  "aggregate" for the weighted aggregate score, otherwise pass a criterion
  name verbatim.
- For statistics, prefer compute_stats over fetching all candidates and
  counting by hand.
- For deep-dive questions about one candidate, fetch raw resume text — the
  structured profile may miss nuance.
- Reference candidates by name when responding; reference criteria by name
  when explaining scores.
- Keep responses tight and actionable — one short paragraph or a brief
  bulleted list is usually enough."""


def build_system_prompt(
    role_title: str,
    job_description: str,
    criteria: Iterable[dict],
    candidate_count: int,
) -> str:
    crit_lines = []
    for c in criteria:
        name = c.get("name") or "(unnamed)"
        weight = c.get("weight", 1.0)
        desc = (c.get("description") or "").strip()
        line = f"- {name} (weight {weight})"
        if desc:
            line += f": {desc}"
        crit_lines.append(line)
    criteria_block = "\n".join(crit_lines) if crit_lines else "(no criteria defined yet)"

    jd = (job_description or "").strip() or "(no job description provided)"

    return f"""You are an HR analysis assistant for the role: {role_title}.

Job Description:
{jd}

Scoring Criteria:
{criteria_block}

Current candidate pool: {candidate_count} applicants.

You have tools to query candidate data, compute statistics, and (in due
course) control the UI (highlights, sorting). Use them to answer the HR
professional's questions accurately.

{_BEHAVIOR_RULES}
"""
