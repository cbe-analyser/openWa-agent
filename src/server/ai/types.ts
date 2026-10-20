import type { AIProviderKind } from "@prisma/client";

export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatTurn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      /** Provider-native content (e.g. Anthropic thinking + tool_use blocks), replayed verbatim to the same provider. */
      providerData?: { provider: string; model: string; content: unknown };
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface AIRequest {
  system: string;
  messages: ChatTurn[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Ask for a JSON object response (best effort; output is always validated). */
  json?: boolean;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: AIUsage;
  provider: string;
  model: string;
  latencyMs: number;
  providerData?: { provider: string; model: string; content: unknown };
}

export interface IntentResult {
  intent: string;
  urgency: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  language: string;
  sentiment: "positive" | "neutral" | "negative";
  wantsHuman: boolean;
  confidence: number;
}

export interface ConversationSummary {
  summary: string;
  openIssues: string[];
}

export interface ProviderHealth {
  ok: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}

export interface IntentDefinition {
  name: string;
  description: string;
}

/** The provider-independent interface every AI adapter implements. */
export interface AIProvider {
  readonly kind: AIProviderKind;
  readonly model: string;
  readonly label: string;
  generateResponse(input: AIRequest): Promise<AIResponse>;
  classifyIntent(input: {
    text: string;
    history: string;
    intents: IntentDefinition[];
  }): Promise<{ result: IntentResult; response: AIResponse }>;
  summarizeConversation(input: {
    transcript: string;
  }): Promise<{ result: ConversationSummary; response: AIResponse }>;
  healthCheck(): Promise<ProviderHealth>;
}

export interface ProviderRuntimeConfig {
  id: string;
  kind: AIProviderKind;
  name: string;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  maxRetries: number;
  contextTokenLimit: number;
  settings: Record<string, unknown>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
