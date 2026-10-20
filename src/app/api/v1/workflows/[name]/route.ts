import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { badRequest, notFound } from "@/server/errors";
import { requirePermission } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { auditCtx } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { getConversationOrThrow, sendTemplateMessage, setStatus } from "@/server/services/conversations";
import { getDocument, updateDocument } from "@/server/services/knowledge";
import { safeFetch } from "@/server/security/ssrf";
import { htmlToText } from "@/server/knowledge/extract";

/**
 * Authorized workflows that external systems can trigger (each requires `workflows:trigger`
 * plus the permission of the underlying action):
 *   escalate-conversation, resolve-conversation, send-template, refresh-url-document
 */
export const POST = route<{ name: string }>(
  { auth: "any", permission: "workflows:trigger", idempotent: true, rateLimit: { limit: 60, windowSec: 60 } },
  async (req, { ctx, params }) => {
    switch (params.name) {
      case "escalate-conversation": {
        requirePermission(ctx, "conversations:write");
        const b = await parseJson(
          req,
          z.object({ conversationId: z.string().max(40), reason: z.string().min(3).max(300) }),
        );
        const conv = await getConversationOrThrow(ctx, b.conversationId);
        if (conv.control === "HUMAN") return { escalated: false, reason: "already_human_controlled" };
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { control: "PENDING_HUMAN", status: "ESCALATED", controlVersion: { increment: 1 } },
        });
        await auditCtx(
          ctx,
          "conversation.escalated",
          { type: "conversation", id: conv.id },
          { reason: b.reason, via: "workflow" },
        );
        await emitEvent(ctx.orgId, "conversation.escalated", {
          conversation_id: conv.id,
          reasons: [b.reason],
        });
        return { escalated: true };
      }
      case "resolve-conversation": {
        const b = await parseJson(
          req,
          z.object({ conversationId: z.string().max(40), resolutionNote: z.string().max(2000).optional() }),
        );
        await setStatus(ctx, b.conversationId, "RESOLVED", b.resolutionNote);
        return { resolved: true };
      }
      case "send-template": {
        const b = await parseJson(
          req,
          z.object({
            conversationId: z.string().max(40),
            name: z.string().regex(/^[a-z0-9_]{1,512}$/),
            language: z.string().min(2).max(15),
            bodyParams: z.array(z.string().max(1000)).max(20).default([]),
          }),
        );
        const msg = await sendTemplateMessage(ctx, b.conversationId, b);
        return { queued: true, messageId: msg.id };
      }
      case "refresh-url-document": {
        requirePermission(ctx, "knowledge:write");
        const b = await parseJson(req, z.object({ documentId: z.string().max(40) }));
        const doc = await getDocument(ctx, b.documentId);
        if (!doc.url) throw badRequest("Document was not imported from a URL");
        const res = await safeFetch(doc.url, { timeoutMs: 15_000, maxBytes: 3 * 1024 * 1024 });
        if (res.status !== 200) throw badRequest(`The page responded with HTTP ${res.status}`);
        const raw = res.body.toString("utf8");
        const text = (res.headers.get("content-type") ?? "").includes("html") ? htmlToText(raw).text : raw;
        const updated = await updateDocument(ctx, doc.id, { text });
        return { refreshed: true, status: updated.status };
      }
      default:
        throw notFound("Workflow");
    }
  },
);
