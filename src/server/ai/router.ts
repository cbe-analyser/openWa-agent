import type { AIProviderConfig } from "@prisma/client";
import { prisma } from "../db";
import { decryptSecret } from "../security/crypto";
import { logger, errorMessage } from "../logger";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import { OllamaProvider } from "./providers/ollama";
import { OpenAICompatibleProvider } from "./providers/openai";
import { estimateCostUsd } from "./pricing";
import { type AIProvider, type AIResponse, type ProviderRuntimeConfig } from "./types";

export type ProviderFactory = (cfg: ProviderRuntimeConfig) => AIProvider;

const defaultFactory: ProviderFactory = (cfg) => {
  switch (cfg.kind) {
    case "ANTHROPIC":
      return new AnthropicProvider(cfg);
    case "OPENAI_COMPATIBLE":
      return new OpenAICompatibleProvider(cfg);
    case "OLLAMA":
      return new OllamaProvider(cfg);
    case "MOCK":
      return new MockProvider(cfg);
  }
};

let factory: ProviderFactory = defaultFactory;

/** Test hook: replace how provider instances are created. */
export function setProviderFactory(f: ProviderFactory | null) {
  factory = f ?? defaultFactory;
}

export function toRuntimeConfig(c: AIProviderConfig): ProviderRuntimeConfig {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    model: c.model,
    baseUrl: c.baseUrl,
    apiKey: c.encryptedApiKey ? decryptSecret(c.encryptedApiKey) : null,
    maxOutputTokens: c.maxOutputTokens,
    temperature: c.temperature,
    timeoutMs: c.timeoutMs,
    maxRetries: c.maxRetries,
    contextTokenLimit: c.contextTokenLimit,
    settings: (c.settings ?? {}) as Record<string, unknown>,
  };
}

export function createProvider(c: AIProviderConfig): AIProvider {
  return factory(toRuntimeConfig(c));
}

export class NoProviderAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoProviderAvailableError";
  }
}

export interface RoutedResult<T> {
  value: T;
  response: AIResponse;
  config: AIProviderConfig;
  fellBack: boolean;
}

async function tokensUsedThisMonth(configId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const agg = await prisma.usageRecord.aggregate({
    where: { providerConfigId: configId, createdAt: { gte: start } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
}

/**
 * Routes AI calls for one organization: the primary provider first, then — only if the
 * provider configuration explicitly allows it (allowAsFallback) — fallback providers in priority order.
 * Every attempt is recorded in UsageRecord with token counts and estimated cost.
 */
export class AIRouter {
  private constructor(
    readonly orgId: string,
    private readonly configs: AIProviderConfig[],
  ) {}

  static async forOrg(orgId: string): Promise<AIRouter> {
    const configs = await prisma.aIProviderConfig.findMany({
      where: { orgId, enabled: true },
      orderBy: [{ isPrimary: "desc" }, { fallbackPriority: "asc" }, { createdAt: "asc" }],
    });
    return new AIRouter(orgId, configs);
  }

  get hasProvider() {
    return this.configs.length > 0;
  }

  private async candidates(): Promise<AIProviderConfig[]> {
    const primary = this.configs.find((c) => c.isPrimary) ?? this.configs[0];
    if (!primary) return [];
    const ordered = [primary, ...this.configs.filter((c) => c.id !== primary.id && c.allowAsFallback)];
    const out: AIProviderConfig[] = [];
    for (const c of ordered) {
      if (c.monthlyTokenBudget && (await tokensUsedThisMonth(c.id)) >= c.monthlyTokenBudget) {
        logger.warn(
          { orgId: this.orgId, providerConfigId: c.id },
          "AI provider skipped: monthly token budget reached",
        );
        continue;
      }
      out.push(c);
    }
    return out;
  }

  async run<T>(
    kind: "chat" | "classify" | "summary",
    fn: (provider: AIProvider) => Promise<{ value: T; response: AIResponse }>,
    meta: { agentRunId?: string; pinnedConfigId?: string } = {},
  ): Promise<RoutedResult<T>> {
    let candidates = await this.candidates();
    if (meta.pinnedConfigId) candidates = candidates.filter((c) => c.id === meta.pinnedConfigId);
    if (candidates.length === 0)
      throw new NoProviderAvailableError("No AI provider is configured or within budget");
    const errors: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const config = candidates[i]!;
      const started = Date.now();
      try {
        const provider = createProvider(config);
        const { value, response } = await fn(provider);
        await this.record(config, kind, response, true, meta.agentRunId);
        return { value, response, config, fellBack: i > 0 };
      } catch (err) {
        errors.push(`${config.name}: ${errorMessage(err)}`);
        await prisma.usageRecord.create({
          data: {
            orgId: this.orgId,
            providerConfigId: config.id,
            agentRunId: meta.agentRunId,
            kind,
            provider: config.kind,
            model: config.model,
            success: false,
            latencyMs: Date.now() - started,
          },
        });
        logger.warn(
          { orgId: this.orgId, provider: config.kind, err: errorMessage(err) },
          "AI provider call failed",
        );
      }
    }
    throw new NoProviderAvailableError(`All AI providers failed: ${errors.join(" | ")}`);
  }

  private async record(
    config: AIProviderConfig,
    kind: string,
    response: AIResponse,
    success: boolean,
    agentRunId?: string,
  ) {
    await prisma.usageRecord.create({
      data: {
        orgId: this.orgId,
        providerConfigId: config.id,
        agentRunId,
        kind,
        provider: config.kind,
        model: response.model || config.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: estimateCostUsd(
          config.kind,
          config.model,
          response.usage.inputTokens,
          response.usage.outputTokens,
          config,
        ),
        latencyMs: response.latencyMs,
        success,
      },
    });
  }
}

/** Runs a provider health check and stores the result on the configuration. */
export async function checkProviderHealth(config: AIProviderConfig) {
  let health;
  try {
    health = await createProvider(config).healthCheck();
  } catch (err) {
    health = { ok: false, latencyMs: 0, model: config.model, error: errorMessage(err) };
  }
  await prisma.aIProviderConfig.update({
    where: { id: config.id },
    data: {
      lastHealthStatus: health.ok ? "healthy" : "unhealthy",
      lastHealthAt: new Date(),
      lastHealthError: health.error?.slice(0, 500) ?? null,
    },
  });
  return health;
}
