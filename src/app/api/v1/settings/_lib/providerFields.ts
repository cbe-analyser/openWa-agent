import { z } from "zod";

export const providerFields = {
  name: z.string().min(1).max(60),
  kind: z.enum(["ANTHROPIC", "OPENAI_COMPATIBLE", "OLLAMA", "MOCK"]),
  model: z.string().min(1).max(120),
  baseUrl: z.string().url().max(500).nullable().optional(),
  apiKey: z.string().max(500).nullable().optional(),
  maxOutputTokens: z.number().int().min(64).max(64000).optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  timeoutMs: z.number().int().min(2000).max(600000).optional(),
  maxRetries: z.number().int().min(0).max(6).optional(),
  contextTokenLimit: z.number().int().min(1000).max(2_000_000).optional(),
  monthlyTokenBudget: z.number().int().positive().nullable().optional(),
  inputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
  outputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
  settings: z.record(z.unknown()).optional(),
  isPrimary: z.boolean().optional(),
  allowAsFallback: z.boolean().optional(),
  fallbackPriority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
};
