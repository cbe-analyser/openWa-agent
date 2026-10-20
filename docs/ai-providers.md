# AI providers

OpenWa Agent does not ship with, or depend on, any particular AI vendor. Each organization adds its own providers under **AI agent → AI providers**. API keys are stored encrypted with `ENCRYPTION_KEY`, are never returned by the API (only "key set") and never reach the browser after you save them.

| Kind                  | Use for                                                                                                                                         | Base URL                                                | Key              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| **Anthropic**         | Claude models                                                                                                                                   | Leave empty for Anthropic's API                         | Required         |
| **OpenAI-compatible** | OpenAI, Azure OpenAI-compatible gateways, OpenRouter, Together, Groq, vLLM, LM Studio, LocalAI and others that implement `/v1/chat/completions` | e.g. `https://api.openai.com/v1`, `http://vllm:8000/v1` | Usually required |
| **Ollama**            | Self-hosted open models                                                                                                                         | e.g. `http://ollama:11434`                              | Not needed       |
| **Mock**              | Demos and tests. Deterministic keyword rules, **not a language model**                                                                          | —                                                       | —                |

After saving, click **Test**. It sends a short request and records the result and latency as the provider's health.

## Choosing a model

The agent needs a model that follows instructions reliably, produces JSON on request and supports tool calling. In general:

- **Hosted frontier models** (for example Anthropic's current Claude models) give the best grounding, tool use and multilingual replies. The Anthropic default in the form is `claude-opus-5-5`; smaller, cheaper models are fine for high-volume FAQ traffic.
- **Self-hosted models** work, but quality varies a lot. Use instruction-tuned models with tool support (for example Llama 3.1/3.3, Qwen 2.5 or newer). Start in **Copilot** mode and review drafts before raising autonomy.

Whatever you choose, test it in the **Simulator** with your own knowledge base before connecting a real number.

## Common settings

| Field                                  | Meaning                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Model                                  | Provider's model identifier                                                                    |
| Max output tokens                      | Cap per reply (default 1024)                                                                   |
| Temperature                            | Optional. Leave empty to use the provider default                                              |
| Timeout / retries                      | Per request (default 45 s, 2 retries on retryable errors)                                      |
| Context token limit                    | Approximate budget for history and knowledge in the prompt (Ollama also uses it as `num_ctx`)  |
| Monthly token budget                   | When reached, the provider is skipped until the next calendar month (UTC)                      |
| Input / output cost per million tokens | Used for cost estimates. If empty, a built-in price list is used for known models              |
| Primary                                | The provider used first. One per organization                                                  |
| Allow as fallback / priority           | Whether, and in which order, conversations may be sent to this provider when the primary fails |

### Advanced settings (JSON)

| Key                  | Provider                     | Effect                                                                                                                                                                              |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort`             | Anthropic                    | `"low"`, `"medium"`, `"high"`, `"xhigh"` or `"max"`; passed as `output_config.effort`                                                                                               |
| `serverSideFallback` | Anthropic                    | Default `true` for models that support it: Anthropic retries on a compatible model when the requested one is overloaded. Set `false` to disable                                     |
| `sendTemperature`    | Anthropic, OpenAI-compatible | Anthropic: `true` to send temperature (current Claude models reject sampling parameters, so it is off by default). OpenAI-compatible: `false` to omit it, for models that reject it |
| `maxTokensParam`     | OpenAI-compatible            | `"max_completion_tokens"` for APIs that require it                                                                                                                                  |
| `jsonMode`           | OpenAI-compatible            | `false` if the server does not support `response_format: json_object`                                                                                                               |
| `simulateOutage`     | Mock                         | `true` makes every call fail with a retryable error, for testing fallback                                                                                                           |

## Fallback and data handling

When the primary provider fails (after its own retries for timeouts, 429 and 5xx errors) or is over budget, the router tries the other enabled providers **that you marked "allow as fallback"**, in priority order. A provider that is not marked is never used as a fallback, so conversation content only goes to providers you approved. Within one agent run, all tool-calling rounds stay on the same provider.

Every attempt, successful or failed, is recorded under **Usage & costs** with provider, model, tokens, latency and estimated cost. If no provider is available, the message is kept and the run is retried with exponential backoff; when the retries are used up, the conversation is escalated to a human with the reason `ai_unavailable` instead of failing silently.

Think about where each provider processes data. Customer messages and knowledge excerpts are sent to the provider. See [data-protection.md](data-protection.md).

## Ollama (self-hosted)

The Compose file includes an optional Ollama service:

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull llama3.1:8b
```

Then add an Ollama provider with base URL `http://ollama:11434` and model `llama3.1:8b`.

### Hardware guidance (rough)

| Model size | Memory needed (4-bit quantized) | Practical hardware                                                                            |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| 7–8B       | ~6–8 GB                         | 8 GB GPU, or a modern CPU with 16 GB RAM (slow: several seconds to tens of seconds per reply) |
| 13–14B     | ~10–12 GB                       | 12–16 GB GPU                                                                                  |
| 30–32B     | ~20–24 GB                       | 24 GB GPU                                                                                     |
| 70B        | ~40–48 GB                       | 48 GB+ GPU or multiple GPUs                                                                   |

CPU-only inference works for testing and very low volume. For customer-facing use, a GPU is strongly recommended, because the agent makes two to four model calls per customer message (classification, then one or more reasoning and tool rounds). Small models are noticeably worse at tool calling and JSON; expect more escalations and drafts.

## Embeddings

Knowledge search uses embeddings plus PostgreSQL full-text search. Configure under **AI agent → Embeddings**:

| Kind              | Notes                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Local (default)   | Offline lexical hashing, 384 dimensions. No network, no cost. Matches words and close spellings, not meaning |
| OpenAI-compatible | e.g. `text-embedding-3-small`. Semantic search                                                               |
| Ollama            | e.g. `nomic-embed-text`. Semantic search, self-hosted                                                        |

Changing the embedding model re-indexes all documents in the background. **Minimum relevance** (default 0.15) sets how close a chunk must be to count as evidence; below it the agent says it does not have the information.
