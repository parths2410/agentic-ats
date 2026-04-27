# Deep dive · LLM provider abstraction

> Anthropic today, Azure OpenAI tomorrow, AWS Bedrock the day after.
> One ABC, four methods, ~50 lines per provider implementation. The loop
> doesn't change.

---

## Why this exists

There are two reasons not to call a vendor SDK directly from your services.

**1. Vendor lock-in is a strategic risk.** Models change. Prices change.
Compliance constraints arrive ("our customers' data must flow through
Azure"). A codebase tightly coupled to a single SDK has to be rewritten to
respond. A codebase that depends on an interface only has to grow a new
implementation.

**2. Native SDKs leak abstractions.** Anthropic's tool-use blocks have a
specific JSON shape. OpenAI's function-calling has a different one. AWS
Bedrock can wrap either via a third shape. If you let any of those leak into
your service code, you're committed.

Our solution: a four-method abstract base class. Every call site in the
system depends on `LLMProvider`, never on a vendor SDK. Vendor specifics live
in `app/llm/anthropic_provider.py` (or any sibling) and are translated at the
boundary.

---

## The interface

```python
class LLMProvider(ABC):
    """Interface for swappable LLM providers."""

    @abstractmethod
    async def extract_criteria(self, job_description: str) -> list[CriterionProposal]:
        """Propose scoring criteria from a job description."""
        ...

    @abstractmethod
    async def parse_resume(self, raw_text: str) -> dict[str, Any]:
        """Parse a resume's raw text into a StructuredProfile dict."""
        ...

    @abstractmethod
    async def score_candidate(
        self,
        profile: dict[str, Any],
        job_description: str,
        criteria: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Score a candidate against criteria.

        Returns {"scores": [{criterion_name, score, rationale}, ...],
                 "overall_summary": str}.
        """
        ...

    @abstractmethod
    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[dict[str, Any]],
        system_prompt: str,
    ) -> LLMResponse:
        """One agentic-loop turn: send messages + tool defs, get text and/or tool calls.

        Implementations map this to their native tool-use API. The loop lives
        in ChatService — this method MUST NOT loop on its own.
        """
        ...
```

Three methods are *task-level* (`extract_criteria`, `parse_resume`,
`score_candidate`) — they describe a goal in the application's language, not
the LLM's. The fourth, `chat`, is *turn-level* — it's the primitive the
agentic loop drives.

### Normalised types

The interface uses our own dataclasses, not vendor types:

```python
@dataclass
class LLMMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[ContentBlock] | dict
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None

@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]

@dataclass
class LLMResponse:
    text: str
    tool_calls: list[ToolCall]

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)
```

These are our types. Anthropic's SDK uses `MessageParam`. OpenAI's SDK uses
`ChatCompletionMessageParam`. They translate at the provider boundary. The
chat loop, the resume pipeline, and the criteria service only know about
`LLMMessage` and `LLMResponse`.

---

## The Anthropic provider

The whole `chat` method is 15 lines:

```python
async def chat(
    self,
    messages: list[LLMMessage],
    tools: list[dict[str, Any]],
    system_prompt: str,
) -> LLMResponse:
    anthropic_messages = self._to_anthropic_messages(messages)
    message = await _with_retry(lambda: self._client.messages.create(
        model=self._model,
        max_tokens=2048,
        system=system_prompt,
        tools=tools or None,
        messages=anthropic_messages,
    ))
    return self._parse_chat_response(message)
```

The work is in:

- `_to_anthropic_messages(messages)` — translates our `LLMMessage` list to
  Anthropic's wire format. Tool calls become `tool_use` content blocks; tool
  results become `tool_result` blocks under `role="user"`. ~30 LOC.
- `_parse_chat_response(message)` — walks Anthropic's content blocks and
  extracts text and tool calls into our `LLMResponse`. ~20 LOC.
- `_with_retry(...)` — exponential backoff for `RateLimitError`,
  `APIConnectionError`, `InternalServerError`. ~30 LOC, shared across every
  method.

Total provider implementation: ~250 LOC including all four methods and the
shared retry helper.

### Forbidden behavior

The docstring says it: **the provider must not loop**. Anthropic's SDK
exposes helpers that do "automatic tool use" — call the model, run tools,
call again, repeat. We don't use them. The split between provider (one
turn) and service (the loop) is what makes the rest of the architecture
work, and we don't compromise it for SDK convenience.

---

## What an Azure OpenAI provider looks like

Same shape, different translators:

```python
class AzureOpenAIProvider(LLMProvider):
    def __init__(
        self,
        endpoint: str,
        deployment: str,
        api_key: str,
        api_version: str = "2024-08-01-preview",
    ) -> None:
        self._client = AsyncAzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
        )
        self._deployment = deployment

    async def chat(self, messages, tools, system_prompt) -> LLMResponse:
        oai_messages = self._to_oai_messages(messages, system_prompt)
        oai_tools = [{"type": "function", "function": t} for t in (tools or [])]

        completion = await _with_retry(lambda: self._client.chat.completions.create(
            model=self._deployment,
            messages=oai_messages,
            tools=oai_tools or None,
            tool_choice="auto",
            max_tokens=2048,
        ))
        return self._parse_chat_response(completion)

    # ... extract_criteria, parse_resume, score_candidate stay structurally
    # identical: build user prompt with the same builder, call self._client,
    # json.loads, validate.
```

The translator pair (`_to_oai_messages` / `_parse_chat_response`) handles
the schema differences:

| concept | Anthropic | OpenAI |
|---|---|---|
| system prompt | top-level `system=` parameter | first message with `role="system"` |
| tool definitions | `tools=[{name, description, input_schema}]` | `tools=[{type: "function", function: {name, description, parameters}}]` |
| tool calls | `tool_use` content blocks under assistant message | `tool_calls` array on assistant message |
| tool results | `tool_result` content blocks under user message | `role="tool"` message with `tool_call_id` |
| stop reasons | `stop_reason: "tool_use" | "end_turn"` | `finish_reason: "tool_calls" | "stop"` |

The translation is mechanical. Both schemas express the same things, just
arranged differently. The translators are <50 LOC each side.

---

## What stays the same across providers

This is the important part — what the provider *doesn't* affect:

### The four prompts

`extract_criteria`, `parse_resume`, `score_candidate`, and `chat_system` are
plain strings with no model-specific tokens. They have been tested across
providers. The schema-anchored output discipline (see
[03-prompt-strategy.md](./03-prompt-strategy.md)) means parsers are happy
with whichever model produces the JSON.

### The chat loop

`ChatService.handle_message` calls `self.llm.chat(...)`. It has no opinions
about what's behind the interface.

### The tool definitions

`backend/app/tools/definitions.py` uses Anthropic's `input_schema` shape.
For OpenAI's `parameters` shape, the translator wraps it (the inside JSON
Schema is the same). One-liner.

### The accumulator

`UIMutationsAccumulator` operates on `mutation` dicts produced by our action
tools. Provider-agnostic.

### The DB

Roles, candidates, criteria, scores, chat_messages, ui_states. None of these
care which model wrote the contents.

---

## Multi-provider deployment patterns

A few shapes Spine could deploy in:

### 1. Single provider per environment

The simplest: dev uses Anthropic, prod uses Azure OpenAI. The provider is
selected at app startup from a config flag. One running process, one
provider.

```python
# backend/app/config.py
def make_provider() -> LLMProvider:
    kind = os.environ["LLM_PROVIDER"]  # "anthropic" | "azure-openai"
    if kind == "anthropic":
        return AnthropicProvider(model=..., api_key=...)
    elif kind == "azure-openai":
        return AzureOpenAIProvider(endpoint=..., deployment=..., api_key=...)
    raise ValueError(f"unknown provider: {kind}")
```

### 2. Per-tenant provider

For Spine's enterprise customers who insist on their own Azure tenant, the
provider could be selected per-request from a tenant config:

```python
def get_provider_for_tenant(tenant_id: str) -> LLMProvider:
    cfg = tenant_config_cache.get(tenant_id)
    return AzureOpenAIProvider(
        endpoint=cfg.azure_endpoint,
        deployment=cfg.azure_deployment,
        api_key=cfg.azure_api_key,
    )
```

Each tenant has its own Azure OpenAI deployment under their own Azure
subscription. Data flow stays inside their tenant. The same agentic engine
serves them all.

### 3. Per-task provider

Some tasks have different cost/latency profiles than others. Resume
*structuring* benefits from a fast cheap model; resume *scoring* benefits
from a careful one. The interface allows mixing:

```python
class HybridProvider(LLMProvider):
    def __init__(self, fast: LLMProvider, careful: LLMProvider) -> None:
        self._fast = fast
        self._careful = careful

    async def parse_resume(self, raw_text):
        return await self._fast.parse_resume(raw_text)

    async def score_candidate(self, ...):
        return await self._careful.score_candidate(...)

    async def chat(self, messages, tools, system_prompt):
        return await self._careful.chat(messages, tools, system_prompt)

    async def extract_criteria(self, jd):
        return await self._careful.extract_criteria(jd)
```

This is a delegation pattern — `HybridProvider` is itself a `LLMProvider`,
so the rest of the system doesn't notice. We haven't shipped this; we
mention it because the abstraction supports it.

---

## Testing across providers

The test suite uses a `FakeLLMProvider` that:

- For `chat`: returns canned `LLMResponse` objects programmed by the test.
- For `extract_criteria` / `parse_resume` / `score_candidate`: returns canned
  dicts.

This means the loop tests don't depend on any real LLM. They run in
milliseconds. Provider implementations have their own targeted tests
(`test_anthropic_provider.py`) that mock the SDK and verify the translation
layer. **The two layers are tested independently.**

When we add `AzureOpenAIProvider`, the rest of the suite continues to pass
unchanged; we add `test_azure_openai_provider.py` that mocks the OpenAI
SDK in the same way.

---

## Cost / failure isolation

Every provider implements the same retry policy:

```python
async def _with_retry(call: Callable, max_attempts: int = 3) -> Any:
    delay = 1.0
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return await call()
        except (RateLimitError, APIConnectionError, InternalServerError) as e:
            last_exc = e
            if attempt == max_attempts:
                break
            await asyncio.sleep(delay + random.uniform(0, 0.5))
            delay *= 2
    raise last_exc
```

Backoff with jitter, three attempts. After three, we surface the failure
to the caller — which, depending on the call site, results in either an
errored candidate (resume pipeline) or an error frame on the chat
WebSocket. We never silently degrade.

The retry wrapper is part of each provider, not the abstract class, because
different providers expose different transient-error types. `_with_retry`
in the Anthropic provider catches Anthropic's; in the OpenAI provider it
catches OpenAI's. The behaviour is the same; the catch list differs.

---

## What changes for Spine

- **Add `AzureOpenAIProvider`.** ~250 LOC including translators and tests.
  ~3–5 days of engineering.
- **Add per-tenant provider selection.** A small config service that maps
  tenant → provider config. ~150 LOC.
- **Add token-usage extraction.** Both Anthropic and OpenAI return usage
  data in the response; surfacing it through `LLMResponse` is one new field
  and one extraction call per provider. ~30 LOC.
- **Add structured logs.** Provider name, model, latency, input/output tokens
  per call. Wires into observability work in the
  [roadmap](../index.html#roadmap).

That's the whole list. The shape we built was deliberately for this.

---

## Files

- `backend/app/llm/base.py` — the `LLMProvider` ABC, `LLMMessage`, `ToolCall`, `LLMResponse`.
- `backend/app/llm/anthropic_provider.py` — production provider; translators and retry.
- `backend/app/llm/_fakes.py` — `FakeLLMProvider` for tests.
- `backend/tests/test_anthropic_provider.py` — provider-level tests of translators and retries.
- `backend/tests/test_chat_service.py` — uses `FakeLLMProvider` exclusively, never sees a real SDK.
