import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { buildSimulatedInbound } from "@/server/channels/simulator";
import { ingestWebhook } from "@/server/channels/inbound";

/**
 * Sends a simulated customer message into a SIMULATOR channel. The payload has the exact
 * WhatsApp Cloud API webhook shape and goes through the same parser and pipeline as real traffic.
 */
export const POST = route<{ channelId: string }>(
  { auth: "any", permission: "conversations:write", rateLimit: { limit: 120, windowSec: 60 } },
  async (req, { ctx, params }) => {
    const channel = await prisma.channel.findFirst({
      where: { id: params.channelId, orgId: ctx.orgId, kind: "SIMULATOR" },
    });
    if (!channel) throw notFound("Simulator channel");
    const b = await parseJson(
      req,
      z.object({
        from: z.string().regex(/^\d{6,15}$/, "Use digits only, e.g. 254700000001"),
        name: z.string().min(1).max(60),
        text: z.string().min(1).max(4096).optional(),
        buttonReply: z.object({ id: z.string().max(256), title: z.string().max(20) }).optional(),
      }),
    );
    const { id, payload } = buildSimulatedInbound({ phoneNumberId: channel.phoneNumberId ?? "sim", ...b });
    const raw = JSON.stringify(payload);
    await ingestWebhook(channel, raw, payload);
    const message = await prisma.message.findUnique({
      where: { channelId_externalId: { channelId: channel.id, externalId: id } },
      select: { id: true, conversationId: true },
    });
    return NextResponse.json(
      { externalId: id, messageId: message?.id, conversationId: message?.conversationId },
      { status: 201 },
    );
  },
);

export const GET = route<{ channelId: string }>(
  { auth: "any", permission: "conversations:read" },
  async (req, { ctx, params }) => {
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const channel = await prisma.channel.findFirst({
      where: { id: params.channelId, orgId: ctx.orgId, kind: "SIMULATOR" },
    });
    if (!channel) throw notFound("Simulator channel");
    const customer = await prisma.customer.findUnique({
      where: { orgId_waId: { orgId: ctx.orgId, waId: from } },
    });
    if (!customer) return { messages: [] };
    const conv = await prisma.conversation.findUnique({
      where: { channelId_customerId: { channelId: channel.id, customerId: customer.id } },
    });
    if (!conv) return { messages: [] };
    // What the customer's phone would show: inbound + delivered outbound only.
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        OR: [{ direction: "INBOUND" }, { status: { in: ["SENT", "DELIVERED", "READ"] } }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        direction: true,
        body: true,
        type: true,
        status: true,
        createdAt: true,
        authorType: true,
      },
    });
    return { conversationId: conv.id, control: conv.control, status: conv.status, messages };
  },
);
