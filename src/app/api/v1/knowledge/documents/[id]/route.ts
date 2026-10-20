import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { deleteDocument, getDocument, updateDocument } from "@/server/services/knowledge";

type P = { id: string };

export const GET = route<P>({ auth: "any", permission: "knowledge:read" }, async (_req, { ctx, params }) =>
  getDocument(ctx, params.id),
);

export const PATCH = route<P>(
  { auth: "any", permission: "knowledge:write" },
  async (req, { ctx, params }) => {
    const b = await parseJson(
      req,
      z.object({
        title: z.string().min(2).max(200).optional(),
        text: z.string().min(20).max(2_000_000).optional(),
        category: z.string().max(50).optional(),
      }),
    );
    return updateDocument(ctx, params.id, b);
  },
);

export const DELETE = route<P>(
  { auth: "any", permission: "knowledge:write" },
  async (_req, { ctx, params }) => {
    await deleteDocument(ctx, params.id);
    return { deleted: true };
  },
);
