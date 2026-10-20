import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { notFound } from "@/server/errors";
import {
  addNote,
  assign,
  exportConversation,
  markRead,
  releaseToAI,
  sendHumanMessage,
  sendTemplateMessage,
  setAiPaused,
  setStatus,
  takeOver,
  updateTags,
} from "@/server/services/conversations";

type P = { id: string; action: string };

/** Conversation actions: takeover, release, pause, resume, assign, status, messages, template, notes, tags, read. */
export const POST = route<P>(
  {
    auth: "any",
    permission: "conversations:read",
    idempotent: true,
    rateLimit: { limit: 120, windowSec: 60 },
  },
  async (req, { ctx, params }) => {
    const id = params.id;
    switch (params.action) {
      case "takeover":
        return takeOver(ctx, id);
      case "release":
        return releaseToAI(ctx, id);
      case "pause":
        return setAiPaused(ctx, id, true);
      case "resume":
        return setAiPaused(ctx, id, false);
      case "read":
        await markRead(ctx, id);
        return { ok: true };
      case "assign": {
        const b = await parseJson(req, z.object({ userId: z.string().max(40).nullable() }));
        return assign(ctx, id, b.userId);
      }
      case "status": {
        const b = await parseJson(
          req,
          z.object({
            status: z.enum(["OPEN", "PENDING", "ESCALATED", "RESOLVED"]),
            resolutionNote: z.string().max(2000).optional(),
          }),
        );
        return setStatus(ctx, id, b.status, b.resolutionNote);
      }
      case "messages": {
        const b = await parseJson(req, z.object({ text: z.string().trim().min(1).max(4096) }));
        return NextResponse.json(await sendHumanMessage(ctx, id, b.text), { status: 201 });
      }
      case "template": {
        const b = await parseJson(
          req,
          z.object({
            name: z.string().regex(/^[a-z0-9_]{1,512}$/),
            language: z.string().min(2).max(15),
            bodyParams: z.array(z.string().max(1000)).max(20).default([]),
          }),
        );
        return NextResponse.json(await sendTemplateMessage(ctx, id, b), { status: 201 });
      }
      case "notes": {
        const b = await parseJson(req, z.object({ body: z.string().trim().min(1).max(5000) }));
        return NextResponse.json(await addNote(ctx, id, b.body), { status: 201 });
      }
      case "tags": {
        const b = await parseJson(req, z.object({ tags: z.array(z.string().max(40)).max(20) }));
        return updateTags(ctx, id, b.tags);
      }
      default:
        throw notFound("Action");
    }
  },
);

export const GET = route<P>({ auth: "any", permission: "data:export" }, async (_req, { ctx, params }) => {
  if (params.action !== "export") throw notFound("Action");
  const data = await exportConversation(ctx, params.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="conversation-${params.id}.json"`,
    },
  });
});
