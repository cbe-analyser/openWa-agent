import OpenAI from "openai";
import { BaseProvider, isRetryableStatus } from "./base";
import {
  ProviderError,
  type AIRequest,
  type AIResponse,
  type ChatTurn,
  type ProviderHealth,
  type StopReason,
  type ToolCall,
} from "../types";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Adapter for OpenAI and any server implementing the OpenAI Chat Completions API (vLLM, LM Studio, OpenRouter, Groq, ...). */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly kind = "OPENAI_COMPATIBLE" as const;
  private client: OpenAI;

  constructor(config: ConstructorParameters<typeof BaseProvider>[0]) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey || "not-required",
      baseURL: config.baseUrl || undefined,
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }

  private toMessages(system: string, turns: ChatTurn[]): Msg[] {
    const out: Msg[] = [{ role: "system", content: system }];
    for (const t of turns) {
      if (t.role === "user") out.push({ role: "user", content: t.content });
      else if (t.role === "assistant") {
        out.push({
          role: "assistant",
          content: t.content || null,
          ...(t.toolCalls?.length
            ? {
                tool_calls: t.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                })),
              }
            : {}),
        });
      } else out.push({ role: "tool", tool_call_id: t.toolCallId, content: t.content });
    }
    return out;
  }

  protected async chat(input: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    const maxTokens = input.maxOutputTokens ?? this.config.maxOutputTokens;
    // Official OpenAI reasoning models require max_completion_tokens; most compatible servers accept max_tokens.
    const tokenParam =
      this.config.settings.maxTokensParam === "max_completion_tokens" || !this.config.baseUrl
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens };
    const temperature = input.temperature ?? this.config.temperature;
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create({
        model: this.model,
        messages: this.toMessages(input.system, input.messages),
        ...tokenParam,
        ...(temperature !== null &&
        temperature !== undefined &&
        this.config.settings.sendTemperature !== false
          ? { temperature }
          : {}),
        ...(input.tools?.length
          ? {
              tools: input.tools.map((t) => ({
                type: "function" as const,
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
        ...(input.json && !input.tools?.length && this.config.settings.jsonMode !== false
          ? { response_format: { type: "json_object" as const } }
          : {}),
      });
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        throw new ProviderError(
          `OpenAI-compatible API error ${err.status ?? ""}: ${err.message}`,
          isRetryableStatus(err.status),
          err.status,
        );
      }
      throw new ProviderError(`OpenAI-compatible request failed: ${(err as Error).message}`, true);
    }
    const choice = completion.choices[0];
    if (!choice) throw new ProviderError("Provider returned no choices", true);
    const toolCalls: ToolCall[] = [];
    for (const tc of choice.message.tool_calls ?? []) {
      if (tc.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = { __invalid_json: tc.function.arguments };
      }
      toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
    }
    const stopMap: Record<string, StopReason> = {
      stop: "end",
      tool_calls: "tool_use",
      function_call: "tool_use",
      length: "max_tokens",
      content_filter: "refusal",
    };
    return {
      text: choice.message.content ?? "",
      toolCalls,
      stopReason: stopMap[choice.finish_reason] ?? "other",
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      provider: "OPENAI_COMPATIBLE",
      model: completion.model ?? this.model,
      latencyMs: Date.now() - started,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.client.models.list();
      return { ok: true, latencyMs: Date.now() - started, model: this.model };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, model: this.model, error: (err as Error).message };
    }
  }
}
