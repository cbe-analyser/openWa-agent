import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { notFound } from "@/server/errors";
import { decideDraft } from "@/server/services/conversations";

/** Approve or reject an AI draft: POST /api/v1/messages/{id}/approve | /reject */
export const POST = route<{ id: string; decision: string }>(
  { auth: "any", permission: "messages:send" },
  async (req, { ctx, params }) => {
    if (params.decision === "approve") {
      const b = await parseJson(req, z.object({ text: z.string().trim().min(1).max(4096).optional() }));
      return decideDraft(ctx, params.id, true, b.text);
    }
    if (params.decision === "reject") return decideDraft(ctx, params.id, false);
    throw notFound("Action");
  },
);
