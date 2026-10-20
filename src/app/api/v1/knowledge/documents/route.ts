import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { badRequest } from "@/server/errors";
import {
  createFaqDocument,
  createTextDocument,
  importUrl,
  listDocuments,
  uploadDocument,
} from "@/server/services/knowledge";
import { env } from "@/server/env";

export const GET = route({ auth: "any", permission: "knowledge:read" }, async (_req, { ctx }) => ({
  items: await listDocuments(ctx),
}));

const jsonBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    title: z.string().trim().min(2).max(200),
    text: z.string().min(20).max(2_000_000),
    category: z.string().max(50).optional(),
  }),
  z.object({
    type: z.literal("faq"),
    title: z.string().trim().min(2).max(200),
    category: z.string().max(50).optional(),
    items: z
      .array(z.object({ question: z.string().min(3).max(500), answer: z.string().min(1).max(5000) }))
      .min(1)
      .max(500),
  }),
  z.object({
    type: z.literal("url"),
    url: z.string().url().max(2000),
    title: z.string().max(200).optional(),
    category: z.string().max(50).optional(),
  }),
]);

/** JSON (text, FAQ or URL import) or multipart/form-data with a `file` field (PDF, DOCX, TXT, MD, CSV). */
export const POST = route(
  { auth: "any", permission: "knowledge:write", rateLimit: { limit: 60, windowSec: 3600 } },
  async (req, { ctx }) => {
    const type = req.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > (env().MAX_UPLOAD_MB + 1) * 1024 * 1024)
        throw badRequest(`Files must be at most ${env().MAX_UPLOAD_MB} MB`);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("Missing file");
      const doc = await uploadDocument(
        ctx,
        { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
        {
          title: (form.get("title") as string | null)?.slice(0, 200) || undefined,
          category: (form.get("category") as string | null)?.slice(0, 50) || undefined,
        },
      );
      return NextResponse.json(doc, { status: 201 });
    }
    const b = await parseJson(req, jsonBody);
    const doc =
      b.type === "text"
        ? await createTextDocument(ctx, b)
        : b.type === "faq"
          ? await createFaqDocument(ctx, b)
          : await importUrl(ctx, b);
    return NextResponse.json(doc, { status: 201 });
  },
);
