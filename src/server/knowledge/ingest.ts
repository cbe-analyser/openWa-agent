import { prisma } from "../db";
import { logger, errorMessage } from "../logger";
import { chunkText } from "./chunk";
import { embeddingProviderForOrg, toVectorLiteral } from "./embeddings";

const BATCH = 32;

/** (Re)builds the chunks and embeddings for one document. Idempotent: replaces existing chunks. */
export async function indexDocument(orgId: string, documentId: string): Promise<{ chunks: number }> {
  const doc = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, orgId } });
  if (!doc) throw new Error("Document not found");
  await prisma.knowledgeDocument.update({
    where: { id: doc.id },
    data: { status: "PROCESSING", error: null },
  });
  try {
    const chunks = chunkText(doc.text);
    const { provider } = await embeddingProviderForOrg(orgId);
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      vectors.push(...(await provider.embed(chunks.slice(i, i + BATCH))));
    }
    await prisma.$transaction(
      async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id, orgId } });
        for (let i = 0; i < chunks.length; i++) {
          const id = `${doc.id}_${i}`;
          await tx.$executeRaw`
          INSERT INTO "KnowledgeChunk" ("id", "orgId", "documentId", "ordinal", "content", "embeddingModel", "embedding", "tsv")
          VALUES (${id}, ${orgId}, ${doc.id}, ${i}, ${chunks[i]}, ${provider.model},
                  ${toVectorLiteral(vectors[i]!)}::vector, to_tsvector('simple', ${`${doc.title}\n${chunks[i]}`}))`;
        }
        await tx.knowledgeDocument.update({
          where: { id: doc.id },
          data: { status: "READY", chunkCount: chunks.length, indexedAt: new Date(), error: null },
        });
      },
      { timeout: 60_000 },
    );
    return { chunks: chunks.length };
  } catch (err) {
    logger.error({ orgId, documentId, err: errorMessage(err) }, "Document indexing failed");
    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: { status: "FAILED", error: errorMessage(err).slice(0, 500) },
    });
    throw err;
  }
}
