import type { AIProviderKind } from "@prisma/client";

/**
 * Published list prices (USD per million tokens) for Anthropic models, as of 2026-10.
 * Used only when an administrator has not entered prices on the provider configuration.
 * Prices change; administrators should verify them against the provider's pricing page.
 */
const ANTHROPIC_LIST_PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};

export function estimateCostUsd(
  kind: AIProviderKind,
  model: string,
  inputTokens: number,
  outputTokens: number,
  configured?: { inputCostPerMTok: number | null; outputCostPerMTok: number | null },
): number | null {
  let prices: [number, number] | undefined;
  if (typeof configured?.inputCostPerMTok === "number" && typeof configured.outputCostPerMTok === "number") {
    prices = [configured.inputCostPerMTok, configured.outputCostPerMTok];
  } else if (kind === "ANTHROPIC") {
    prices = ANTHROPIC_LIST_PRICES[model];
  } else if (kind === "OLLAMA" || kind === "MOCK") {
    return 0; // self-hosted / offline: no per-token charge (hardware costs are not tracked)
  }
  if (!prices) return null;
  return (inputTokens / 1e6) * prices[0] + (outputTokens / 1e6) * prices[1];
}
