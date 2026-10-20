import { BaseProvider } from "./base";
import {
  ProviderError,
  type AIRequest,
  type AIResponse,
  type ChatTurn,
  type ProviderHealth,
  type ToolCall,
} from "../types";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  tool_name?: string;
}

interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Adapter for a self-hosted Ollama server (https://ollama.com) using its native /api/chat endpoint. */
export class OllamaProvider extends BaseProvider {
  readonly kind = "OLLAMA" as const;

  private get baseUrl() {
    return (this.config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  }

  private toMessages(system: string, turns: ChatTurn[]): OllamaMessage[] {
    const out: OllamaMessage[] = [{ role: "system", content: system }];
    for (const t of turns) {
      if (t.role === "user") out.push({ role: "user", content: t.content });
      else if (t.role === "assistant") {
        out.push({
          role: "assistant",
          content: t.content,
          ...(t.toolCalls?.length
            ? { tool_calls: t.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) }
            : {}),
        });
      } else out.push({ role: "tool", content: t.content, tool_name: t.name });
    }
    return out;
  }

  protected async chat(input: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    const temperature = input.temperature ?? this.config.temperature;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: this.toMessages(input.system, input.messages),
          ...(input.tools?.length
            ? {
                tools: input.tools.map((t) => ({
                  type: "function",
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
          ...(input.json && !input.tools?.length ? { format: "json" } : {}),
          options: {
            num_predict: input.maxOutputTokens ?? this.config.maxOutputTokens,
            num_ctx: this.config.contextTokenLimit,
            ...(temperature !== null && temperature !== undefined ? { temperature } : {}),
          },
        }),
      });
    } catch (err) {
      throw new ProviderError(`Ollama unreachable: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new ProviderError(
        `Ollama error ${res.status}: ${body}`,
        res.status >= 500 || res.status === 429,
        res.status,
      );
    }
    const data = (await res.json()) as OllamaChatResponse;
    const toolCalls: ToolCall[] = (data.message.tool_calls ?? []).map((c, i) => ({
      id: `ollama_${Date.now()}_${i}`,
      name: c.function.name,
      arguments: c.function.arguments ?? {},
    }));
    return {
      text: data.message.content ?? "",
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : data.done_reason === "length" ? "max_tokens" : "end",
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      provider: "OLLAMA",
      model: data.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tags = (await res.json()) as { models?: Array<{ name: string }> };
      const present = (tags.models ?? []).some(
        (m) => m.name === this.model || m.name.split(":")[0] === this.model,
      );
      return present
        ? { ok: true, latencyMs: Date.now() - started, model: this.model }
        : {
            ok: false,
            latencyMs: Date.now() - started,
            model: this.model,
            error: `Model "${this.model}" is not pulled on the Ollama server`,
          };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, model: this.model, error: (err as Error).message };
    }
  }
}
