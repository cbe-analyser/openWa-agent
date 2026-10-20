import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { createInvitation } from "@/server/services/auth";

export const GET = route({ auth: "session", permission: "conversations:read" }, async (_req, { ctx }) => {
  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, lastLoginAt: true, disabled: true } },
      },
    }),
    ctx.permissions.includes("team:manage")
      ? prisma.invitation.findMany({
          where: { orgId: ctx.orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, expiresAt: true },
        })
      : [],
  ]);
  return { members, invitations };
});

/** Invites a team member. The invitation link is shown once to the inviter (no email service is required). */
export const POST = route(
  { auth: "session", permission: "team:manage", rateLimit: { limit: 30, windowSec: 3600 } },
  async (req, { ctx }) => {
    const b = await parseJson(
      req,
      z.object({ email: z.string().email().max(254), role: z.enum(["OWNER", "ADMIN", "AGENT", "VIEWER"]) }),
    );
    const { invitation, token } = await createInvitation(ctx, b.email, b.role);
    return NextResponse.json(
      {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        inviteUrl: `${env().APP_URL}/invite/${token}`,
      },
      { status: 201 },
    );
  },
);
