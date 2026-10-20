-- Full-text search index for knowledge retrieval. Prisma cannot express GIN indexes on
-- Unsupported("tsvector") columns, so if `prisma migrate dev` ever proposes dropping
-- "KnowledgeChunk_tsv_idx", remove that statement from the generated migration.
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tsv_idx" ON "KnowledgeChunk" USING GIN ("tsv");
