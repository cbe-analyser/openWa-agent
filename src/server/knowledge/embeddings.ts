import OpenAI from "openai";
import type { EmbeddingConfig } from "@prisma/client";
import { prisma } from "../db";
import { decryptSecret } from "../security/crypto";

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalizeToken(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/**
 * Offline embedding using signed feature hashing of word unigrams, bigrams and character
 * trigrams. It captures lexical similarity only (no semantics), needs no network or GPU, and
 * is the default so the knowledge base works out of the box. Configure a neural embedding
 * model (OpenAI-compatible or Ollama) for semantic retrieval.
 */
export class LocalHashEmbedding implements EmbeddingProvider {
  constructor(readonly dimensions = 384) {}

  get model() {
    return `local-hash-${this.dimensions}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const v = new Float64Array(this.dimensions);
    const tokens = (
      text
        .toLowerCase()
        .normalize("NFKD")
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).map(normalizeToken);
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      v[h % this.dimensions]! += (h & 0x80000000 ? -1 : 1) * weight;
    };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      add(`w:${t}`, 1);
      if (i > 0) add(`b:${tokens[i - 1]}_${t}`, 0.5);
      if (t.length >= 5) for (let j = 0; j + 3 <= t.length; j++) add(`c:${t.slice(j, j + 3)}`, 0.15);
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return Array.from(v, (x) => x / norm);
  }
}

class OpenAICompatibleEmbedding implements EmbeddingProvider {
  private client: OpenAI;
  constructor(
    readonly model: string,
    baseUrl: string | null,
    apiKey: string | null,
  ) {
    this.client = new OpenAI({
      apiKey: apiKey || "not-required",
      baseURL: baseUrl || undefined,
      timeout: 30_000,
      maxRetries: 2,
    });
  }
  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: this.model, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

class OllamaEmbedding implements EmbeddingProvider {
  constructor(
    readonly model: string,
    private readonly baseUrl: string,
  ) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}

export function embeddingProviderFrom(
  cfg: Pick<EmbeddingConfig, "kind" | "model" | "baseUrl" | "encryptedApiKey" | "dimensions"> | null,
): EmbeddingProvider {
  if (!cfg || cfg.kind === "LOCAL_HASH") return new LocalHashEmbedding(cfg?.dimensions ?? 384);
  const key = cfg.encryptedApiKey ? decryptSecret(cfg.encryptedApiKey) : null;
  if (cfg.kind === "OPENAI_COMPATIBLE") return new OpenAICompatibleEmbedding(cfg.model, cfg.baseUrl, key);
  return new OllamaEmbedding(cfg.model, cfg.baseUrl || "http://localhost:11434");
}

export async function embeddingProviderForOrg(orgId: string) {
  const cfg = await prisma.embeddingConfig.findUnique({ where: { orgId } });
  return { provider: embeddingProviderFrom(cfg), config: cfg };
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}
