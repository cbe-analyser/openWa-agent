import Anthropic from "@anthropic-ai/sdk";
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

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

/** Models that accept the server-side refusal fallback ("fallbacks": "default"). */
const SERVER_FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/;

export class AnthropicProvider extends BaseProvider {
  readonly kind = "ANTHROPIC" as const;
  private client: Anthropic;

  constructor(config: ConstructorParameters<typeof BaseProvider>[0]) {
    super(config);
    if (!config.apiKey) throw new ProviderError("Anthropic API key is not configured", false);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined,
      timeout: config.timeoutMs,
      maxRetries: 0, // retries are handled uniformly by BaseProvider.withRetry
    });
  }

  private toMessages(turns: ChatTurn[]): BetaMessageParam[] {
    const out: BetaMessageParam[] = [];
    for (const t of turns) {
      if (t.role === "user") {
        out.push({ role: "user", content: t.content });
      } else if (t.role === "assistant") {
        if (t.providerData?.provider === "ANTHROPIC" && t.providerData.model === this.model) {
          // Replay the native content unchanged (keeps thinking blocks valid across the tool loop).
          out.push({ role: "assistant", content: t.providerData.content as BetaContentBlockParam[] });
        } else {
          const blocks: BetaContentBlockParam[] = [];
          if (t.content) blocks.push({ type: "text", text: t.content });
          for (const c of t.toolCalls ?? [])
            blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.arguments });
          out.push({ role: "assistant", content: blocks.length ? blocks : "" });
        }
      } else {
        const block: BetaContentBlockParam = {
          type: "tool_result",
          tool_use_id: t.toolCallId,
          content: t.content,
          is_error: t.isError ?? false,
        };
        const prev = out[out.length - 1];
        // All tool results for one assistant turn go back in a single user message.
        if (
          prev &&
          prev.role === "user" &&
          Array.isArray(prev.content) &&
          prev.content.every((b) => b.type === "tool_result")
        ) {
          (prev.content as BetaContentBlockParam[]).push(block);
        } else {
          out.push({ role: "user", content: [block] });
        }
      }
    }
    return out;
  }

  protected async chat(input: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    const settings = this.config.settings;
    const useServerFallback =
      settings.serverSideFallback !== false && SERVER_FALLBACK_MODELS.test(this.model);
    const effort = typeof settings.effort === "string" ? settings.effort : undefined;

    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: input.maxOutputTokens ?? this.config.maxOutputTokens,
      system: input.system,
      messages: this.toMessages(input.messages),
      ...(input.tools?.length
        ? {
            tools: input.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
            })),
          }
        : {}),
      ...(effort ? { output_config: { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" } } : {}),
      // Current Claude models reject sampling parameters; only send temperature when explicitly enabled.
      ...(settings.sendTemperature === true && (input.temperature ?? this.config.temperature) !== null
        ? { temperature: input.temperature ?? this.config.temperature ?? undefined }
        : {}),
      ...(useServerFallback
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    };

    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await this.client.beta.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(
          `Anthropic API error ${err.status ?? ""}: ${err.message}`,
          isRetryableStatus(err.status),
          err.status,
        );
      }
      throw new ProviderError(`Anthropic request failed: ${(err as Error).message}`, true);
    }

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of msg.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }
    const stopMap: Record<string, StopReason> = {
      end_turn: "end",
      tool_use: "tool_use",
      max_tokens: "max_tokens",
      refusal: "refusal",
      stop_sequence: "end",
    };
    return {
      text,
      toolCalls,
      stopReason: stopMap[msg.stop_reason ?? ""] ?? "other",
      usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
      provider: "ANTHROPIC",
      model: msg.model,
      latencyMs: Date.now() - started,
      providerData: { provider: "ANTHROPIC", model: this.model, content: msg.content },
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await this.client.models.retrieve(this.model);
      return { ok: true, latencyMs: Date.now() - started, model: this.model };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, model: this.model, error: (err as Error).message };
    }
  }
}
