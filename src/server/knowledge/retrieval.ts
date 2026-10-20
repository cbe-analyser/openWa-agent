import { prisma } from "../db";
import { embeddingProviderForOrg, toVectorLiteral } from "./embeddings";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  vectorScore: number | null;
  textScore: number | null;
  score: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  sufficientEvidence: boolean;
}

/** The retrieval layer is behind this interface so it can be replaced (e.g. an external vector DB). */
export interface KnowledgeRetriever {
  search(orgId: string, query: string, k?: number): Promise<RetrievalResult>;
}

function orQuery(query: string): string | null {
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 24))];
  return terms.length ? terms.join(" | ") : null;
}

/** Hybrid retrieval: pgvector cosine similarity + PostgreSQL full-text rank, fused with reciprocal rank fusion. */
export class PgHybridRetriever implements KnowledgeRetriever {
  async search(orgId: string, query: string, k = 5): Promise<RetrievalResult> {
    if (!query.trim()) return { chunks: [], sufficientEvidence: false };
    const { provider, config } = await embeddingProviderForOrg(orgId);
    const minRelevance = config?.minRelevance ?? 0.15;
    const [qvec] = await provider.embed([query]);
    const vec = toVectorLiteral(qvec!);

    const vectorRows = await prisma.$queryRaw<Array<{ id: string; score: number }>>`
      SELECT c."id", 1 - (c."embedding" <=> ${vec}::vector) AS score
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      WHERE c."orgId" = ${orgId} AND d."orgId" = ${orgId} AND d."status" = 'READY'
        AND c."embeddingModel" = ${provider.model} AND c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> ${vec}::vector
      LIMIT 20`;

    const tsq = orQuery(query);
    const textRows = tsq
      ? await prisma.$queryRaw<Array<{ id: string; score: number }>>`
          SELECT c."id", ts_rank(c."tsv", to_tsquery('simple', ${tsq})) AS score
          FROM "KnowledgeChunk" c
          JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
          WHERE c."orgId" = ${orgId} AND d."status" = 'READY' AND c."tsv" @@ to_tsquery('simple', ${tsq})
          ORDER BY score DESC
          LIMIT 20`
      : [];

    const fused = new Map<string, { v: number | null; t: number | null; rrf: number }>();
    vectorRows.forEach((r, i) => {
      const e = fused.get(r.id) ?? { v: null, t: null, rrf: 0 };
      e.v = Number(r.score);
      e.rrf += 1 / (60 + i);
      fused.set(r.id, e);
    });
    textRows.forEach((r, i) => {
      const e = fused.get(r.id) ?? { v: null, t: null, rrf: 0 };
      e.t = Number(r.score);
      e.rrf += 1 / (60 + i);
      fused.set(r.id, e);
    });

    // Drop vector-only matches below the relevance floor.
    const ranked = [...fused.entries()]
      .filter(([, e]) => (e.v ?? 0) >= minRelevance || (e.t ?? 0) > 0)
      .sort((a, b) => b[1].rrf - a[1].rrf)
      .slice(0, k);
    if (ranked.length === 0) return { chunks: [], sufficientEvidence: false };

    const rows = await prisma.knowledgeChunk.findMany({
      where: { id: { in: ranked.map(([id]) => id) }, orgId },
      select: { id: true, documentId: true, content: true, document: { select: { title: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const chunks: RetrievedChunk[] = ranked
      .filter(([id]) => byId.has(id))
      .map(([id, e]) => {
        const r = byId.get(id)!;
        return {
          chunkId: id,
          documentId: r.documentId,
          documentTitle: r.document.title,
          content: r.content,
          vectorScore: e.v,
          textScore: e.t,
          score: e.rrf,
        };
      });
    const sufficientEvidence = chunks.some(
      (c) =>
        (c.vectorScore ?? 0) >= minRelevance * 1.5 ||
        ((c.textScore ?? 0) > 0 && (c.vectorScore ?? 0) >= minRelevance),
    );
    return { chunks, sufficientEvidence };
  }
}

let retriever: KnowledgeRetriever = new PgHybridRetriever();

export function getRetriever(): KnowledgeRetriever {
  return retriever;
}

export function setRetriever(r: KnowledgeRetriever) {
  retriever = r;
}
