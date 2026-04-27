# Presentation plan — Spine Technologies meeting

> A working plan for driving the meeting. Not a script. Use it to anticipate
> the room, sequence the conversation, and know where to stop talking.

---

## Frame in one sentence

> "We've built an agentic hiring engine that's deliberately structured to
> drop into your HRMS. Today I want to walk you through the five subsystems
> that make it more than a wrapper around an LLM API, and then talk about
> what integration looks like for Spine specifically."

---

## Audience read

You answered "mixed product + eng" — which means in the room you'll likely
have one or two technical leads who'll engage with the architecture, plus
business directors who care about *what this means commercially*.

Strategy: **lead with one paragraph of plain-English value, then go technical
with the engineering directors, and pull the room back together at the
integration section** (§ 10) — that's the section that non-engineers care
about because it answers "how does this become a Spine product".

---

## Time budget — assume 45–60 minutes

| Block | Time | Section(s) | What you're doing |
|---|---|---|---|
| Frame + walkthrough thesis | 3 min | TL;DR (§ 1) | Land the one-sentence frame. Show the 5-subsystem list. Ask if they want depth-first or breadth-first. |
| System overview | 5 min | § 2 | Walk the architecture diagram. Name the blue boxes. Don't go deeper here. |
| Agentic loop deep dive | 10 min | § 3 | This is the centerpiece. Sequence diagram first; then the code; then the accumulator and the worked filter-chain example. |
| Tool contract | 8 min | § 4 | Taxonomy table; one schema verbatim; the "adding a tool is 3 files" walkthrough. This is the moment to show how *Spine's HR tools* slot in. |
| Prompts | 5 min | § 5 | Skim the four prompts. Linger on `score_candidate` — the calibration anchors are the most defensible engineering. |
| Resume pipeline | 5 min | § 6 | Diagram + the OCR threshold story + the `stale_scores` invariant. |
| LLM abstraction | 5 min | § 7 | Land the Azure OpenAI swap. **This is the slide they care about most** if they're a Microsoft shop. |
| Integration playbook | 5 min | § 10 | Sidecar topology. C# client snippet. Who owns what. |
| Quality + roadmap | 3 min | § 11 + § 12 | Pull the stats card. Show the 90-day roadmap. |
| Q&A | balance | — | Whatever is left. |

If they're engaged you'll go over. If they're business-leaning, the deep
dives will compress and the integration + roadmap will expand. Either is
fine.

---

## What lands hardest, in our estimation

1. **The loop-not-in-the-provider point** (§ 3 opener). Most people doing
   "agentic" code today let the SDK own the loop. Showing why we don't, and
   what that buys, is a clean architectural statement that engineering
   directors will recognise.

2. **The accumulator worked example** (§ 3, filter chaining). It's the
   moment where the abstract becomes concrete and the room sees the system
   actually thinking. Walk through it slowly.

3. **The "adding a tool is 3 files" claim** (§ 4). Make it tangible. Walk
   through `schedule_interview` from `02-tools-contract.md` if there's
   appetite. This is the argument for *integration*: the engine becomes
   their platform.

4. **The Azure OpenAI swap** (§ 7). For a Microsoft-stack acquirer, this is
   the slide that says "we already designed for your stack". One file, ~250
   LOC. Their CTO will notice.

5. **Coverage 97% / 100% on the loop** (§ 11). Acquihire posture means they
   want to know what they're getting. Ship-ready, not prototype.

---

## What to push past, gently

- **The frontend.** They don't care. Mention it once in § 2 ("React SPA, but
  any client could speak this protocol"); reference §  10's C# snippet to
  reinforce that the UI is theirs to build.
- **Migrations / SQLite.** § 9 is short on purpose. If they ask, say "Postgres
  is two weeks" and move on.
- **Real-time protocol detail.** § 8 is brief. Only go deeper if a backend
  architect specifically asks "how do you stream events".
- **The reference frontend's tests.** 94% frontend coverage is mentioned in
  the stats card. Don't volunteer detail unless asked.

---

## Anticipated questions, with sketches of answers

### "How does this differ from what GitHub Copilot / Microsoft can build in-house?"
The loop-and-tools architecture is reproducible (anyone can build it). What's
not is **the prompts** — the score_candidate calibration anchors, the
behavior rules in the chat system prompt, the anti-confabulation rules in
parse_resume. Those are the result of iteration on real cases. We're not
selling code; we're selling the iterations behind the code.

### "What about prompt injection? A candidate could write 'ignore previous instructions' in their resume."
Two layers. First, the resume parsing prompt explicitly instructs the model
to extract data, not follow instructions in the resume — and the schema-
anchored output discipline means the model must produce JSON, which is hard
to subvert. Second, the chat loop never gives the LLM access to mutating
tools that can leak data (no `send_email`, no `read_other_role_data`). Tool
authorisation is a permission boundary by design.

### "Why Anthropic and not OpenAI / Azure?"
Two reasons: tool-use quality on Claude Sonnet has been measurably better
for our calibration prompts, and Anthropic's API surface is cleaner. Neither
is structural — the abstraction supports OpenAI today, and we expect to add
Azure OpenAI as a first-class provider for Spine deployments. For a
Microsoft enterprise customer, Azure OpenAI is almost certainly where the
inference call will land.

### "What's the cost per resume / per chat turn?"
Resume processing: ~5K tokens per resume → ~$0.02–0.04 each on Claude Sonnet.
Chat turn: highly variable, typically 1–3K tokens, ~$0.01–0.03. Per-tenant
cost accounting is in the roadmap; the data is already in the provider
responses.

### "How long until this is multi-tenant?"
Two to three weeks of focused work. The data model is already keyed by
`role_id`; adding `tenant_id` is a column, a query filter, and a Session
factory. The harder design is *how Spine wants to model tenants* — that's a
conversation, not engineering.

### "Can we run this on-prem?"
Yes. The engine is a Python service plus a relational database. With a
self-hosted LLM (e.g. Bedrock-deployed Claude in a customer's AWS account,
or a local model behind an OpenAI-compatible adapter), the whole stack runs
inside their boundary. We'd add an `OllamaProvider` or similar; ~250 LOC.

### "What's the failure mode when the LLM is down?"
- Resume pipeline: candidate goes to `status=error`, user retries. No data
  loss; the PDF and extracted text are preserved.
- Chat: WebSocket emits an `error` frame. The user retries with one click.
- No silent degradation. Errors are first-class.

### "Why not just use LangChain / LlamaIndex?"
Both ship loops, prompts, and tool layers — but as opinionated frameworks
that are hard to thin out. The cost of disagreeing with their defaults is
high. We chose to write the ~500 lines of orchestration that matter to us,
and own them. The result is a smaller, more auditable codebase. (If we
were doing RAG-heavy work over millions of documents, the calculation would
be different.)

### "How would Spine's developers learn this?"
A week. The loop is 100 lines; the tool contract is the same shape every
time; the prompts are well-commented Python modules. We'd pair on the
first new tool and the first prompt iteration with their team.

---

## Closing move

If the conversation has gone well, end at § 12 (roadmap) and the
"what we'd build with you in 90 days" framing. The work *they'd see* in the
first quarter:

1. Postgres + multi-tenancy + auth (weeks 1–3)
2. Azure OpenAI provider (weeks 2–4)
3. First HR-specific tool (e.g. `schedule_interview`) — joint design (weeks 3–5)
4. Observability + cost accounting (weeks 4–6)
5. .NET client + Spine UI integration (weeks 6–9)
6. Pilot customer (weeks 8–12)

The deliverable framing matters: "in 90 days a real Spine customer is
using this in production" is more compelling than "here's a Gantt chart".

---

## Materials checklist

- `index.html` — open in a browser; share screen.
- `deep-dives/*.md` — for follow-up reading after the meeting.
- `diagrams/*.mmd` — editable sources if they want to copy any diagram into
  internal docs.
- A copy of the repo URL (or a code-walkthrough screen-share) for the
  engineering deep-dive if they want one.
