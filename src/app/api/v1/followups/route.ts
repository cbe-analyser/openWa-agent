import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { getConversationOrThrow } from "@/server/services/conversations";
import { scheduleFollowUp } from "@/server/services/followups";

export const GET = route({ auth: "any", permission: "followups:read" }, async (req, { ctx }) => {
  const q = parseQuery(
    req,
    z.object({
      status: z.enum(["SCHEDULED", "SENT", "CANCELLED", "FAILED", "SKIPPED"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
  );
  const items = await prisma.followUp.findMany({
    where: { orgId: ctx.orgId, ...(q.status ? { status: q.status } : {}) },
    orderBy: { dueAt: q.status === "SCHEDULED" ? "asc" : "desc" },
    take: q.limit,
    include: { customer: { select: { id: true, name: true, profileName: true, waId: true } } },
  });
  return { items };
});

/** Schedule a follow-up. `dueAt` is ISO-8601 (with offset) or a local time interpreted in `timezone`. */
export const POST = route(
  { auth: "any", permission: "followups:write", idempotent: true },
  async (req, { ctx }) => {
    const b = await parseJson(
      req,
      z.object({
        conversationId: z.string().max(40),
        kind: z.enum(["CHECK_IN", "REMINDER", "ESCALATION_REMINDER", "CASE_REVIEW"]),
        dueAt: z.string().datetime({ offset: true }),
        timezone: z.string().max(60).optional(),
        message: z.string().max(4096).optional(),
        templateName: z
          .string()
          .regex(/^[a-z0-9_]{1,512}$/)
          .optional(),
        templateLang: z.string().max(15).optional(),
        reason: z.string().max(300).optional(),
      }),
    );
    await getConversationOrThrow(ctx, b.conversationId);
    const f = await scheduleFollowUp({
      ...b,
      orgId: ctx.orgId,
      dueAt: new Date(b.dueAt),
      createdBy: ctx.kind === "apiKey" ? "API" : "USER",
    });
    return NextResponse.json(f, { status: 201 });
  },
);
