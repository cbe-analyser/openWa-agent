import { prisma } from "../db";
import { env } from "../env";
import { badRequest, notFound } from "../errors";
import { requirePermission, type AuthContext } from "../auth/context";
import { enqueue } from "../jobs/queue";
import { sha256Hex } from "../security/crypto";
import { safeFetch } from "../security/ssrf";
import { extensionOf, extractText, htmlToText, mimeFor } from "../knowledge/extract";
import { getRetriever } from "../knowledge/retrieval";
import { auditCtx } from "./audit";

const MAX_TEXT_CHARS = 2_000_000;

async function createDocument(
  ctx: AuthContext,
  data: {
    title: string;
    sourceType: string;
    text: string;
    category?: string;
    fileName?: string;
    mimeType?: string;
    url?: string;
  },
) {
  const text = data.text.replaceAll(String.fromCharCode(0), "").trim(); // PostgreSQL text cannot store NUL
  if (text.length < 20) throw badRequest("The document contains too little text to index");
  if (text.length > MAX_TEXT_CHARS)
    throw badRequest("The document is too large (over 2 million characters of text)");
  const doc = await prisma.$transaction(async (tx) => {
    const d = await tx.knowledgeDocument.create({
      data: {
        orgId: ctx.orgId,
        title: data.title.slice(0, 200),
        sourceType: data.sourceType,
        category: data.category ?? "general",
        fileName: data.fileName,
        mimeType: data.mimeType,
        url: data.url,
        contentHash: sha256Hex(text),
        text,
        createdById: ctx.userId,
      },
    });
    await enqueue(
      "index_document",
      { documentId: d.id },
      { orgId: ctx.orgId, dedupeKey: `index:${d.id}:${d.contentHash}` },
      tx,
    );
    return d;
  });
  await auditCtx(
    ctx,
    "knowledge.created",
    { type: "document", id: doc.id },
    { sourceType: data.sourceType, title: doc.title },
  );
  return doc;
}

export async function createTextDocument(
  ctx: AuthContext,
  input: { title: string; text: string; category?: string; sourceType?: "TEXT" | "FAQ" },
) {
  requirePermission(ctx, "knowledge:write");
  return createDocument(ctx, {
    title: input.title,
    text: input.text,
    category: input.category,
    sourceType: input.sourceType ?? "TEXT",
  });
}

export async function createFaqDocument(
  ctx: AuthContext,
  input: { title: string; items: Array<{ question: string; answer: string }>; category?: string },
) {
  requirePermission(ctx, "knowledge:write");
  const text = input.items.map((i) => `Q: ${i.question.trim()}\nA: ${i.answer.trim()}`).join("\n\n");
  return createDocument(ctx, {
    title: input.title,
    text,
    category: input.category ?? "faq",
    sourceType: "FAQ",
  });
}

export async function uploadDocument(
  ctx: AuthContext,
  file: { name: string; bytes: Buffer },
  meta: { title?: string; category?: string },
) {
  requirePermission(ctx, "knowledge:write");
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.bytes.length === 0) throw badRequest("The file is empty");
  if (file.bytes.length > maxBytes) throw badRequest(`Files must be at most ${env().MAX_UPLOAD_MB} MB`);
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 150);
  const ext = extensionOf(safeName);
  let text: string;
  try {
    text = await extractText(ext, file.bytes);
  } catch (err) {
    if (err instanceof Error && err.name === "AppError") throw err;
    throw badRequest(`Could not read the file: ${(err as Error).message.slice(0, 200)}`);
  }
  return createDocument(ctx, {
    title: meta.title || safeName.replace(/\.[^.]+$/, ""),
    text,
    category: meta.category,
    fileName: safeName,
    mimeType: mimeFor(ext),
    sourceType: "UPLOAD",
  });
}

/** Imports an approved public web page (SSRF-protected, size-limited, HTML stripped to text). */
export async function importUrl(ctx: AuthContext, input: { url: string; title?: string; category?: string }) {
  requirePermission(ctx, "knowledge:write");
  const res = await safeFetch(input.url, {
    headers: { accept: "text/html,text/plain" },
    timeoutMs: 15_000,
    maxBytes: 3 * 1024 * 1024,
  });
  if (res.status !== 200) throw badRequest(`The page responded with HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const raw = res.body.toString("utf8");
  const { title, text } = type.includes("html") ? htmlToText(raw) : { title: null, text: raw };
  return createDocument(ctx, {
    title: input.title || title || input.url,
    text,
    category: input.category,
    url: input.url,
    sourceType: "URL",
    mimeType: type.split(";")[0],
  });
}

export async function listDocuments(ctx: AuthContext) {
  requirePermission(ctx, "knowledge:read");
  return prisma.knowledgeDocument.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      sourceType: true,
      category: true,
      fileName: true,
      url: true,
      status: true,
      error: true,
      chunkCount: true,
      indexedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getDocument(ctx: AuthContext, id: string) {
  requirePermission(ctx, "knowledge:read");
  const d = await prisma.knowledgeDocument.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!d) throw notFound("Document");
  return d;
}

export async function updateDocument(
  ctx: AuthContext,
  id: string,
  input: { title?: string; text?: string; category?: string },
) {
  requirePermission(ctx, "knowledge:write");
  const d = await getDocument(ctx, id);
  const text = input.text?.trim();
  const changed = text !== undefined && sha256Hex(text) !== d.contentHash;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.knowledgeDocument.update({
      where: { id },
      data: {
        title: input.title ?? d.title,
        category: input.category ?? d.category,
        ...(changed ? { text, contentHash: sha256Hex(text!), status: "PENDING" } : {}),
      },
    });
    if (changed || input.title)
      await enqueue(
        "index_document",
        { documentId: id },
        { orgId: ctx.orgId, dedupeKey: `index:${id}:${u.contentHash}:${Date.now()}` },
        tx,
      );
    return u;
  });
  await auditCtx(ctx, "knowledge.updated", { type: "document", id }, { reindexed: changed });
  return updated;
}

export async function reindexDocument(ctx: AuthContext, id: string) {
  requirePermission(ctx, "knowledge:write");
  await getDocument(ctx, id);
  await enqueue(
    "index_document",
    { documentId: id },
    { orgId: ctx.orgId, dedupeKey: `index:${id}:manual:${Date.now()}` },
  );
  await prisma.knowledgeDocument.update({ where: { id }, data: { status: "PENDING" } });
}

export async function deleteDocument(ctx: AuthContext, id: string) {
  requirePermission(ctx, "knowledge:write");
  await getDocument(ctx, id);
  await prisma.knowledgeDocument.delete({ where: { id } });
  await auditCtx(ctx, "knowledge.deleted", { type: "document", id });
}

export async function testSearch(ctx: AuthContext, query: string) {
  requirePermission(ctx, "knowledge:read");
  return getRetriever().search(ctx.orgId, query, 5);
}
