import { NextResponse } from "next/server";
import { route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { adapterFor } from "@/server/channels/registry";

/** Streams an inbound media attachment from the WhatsApp Cloud API on demand (media is not stored locally). */
export const GET = route<{ messageId: string }>(
  { auth: "session", permission: "conversations:read", rateLimit: { limit: 60, windowSec: 60 } },
  async (_req, { ctx, params }) => {
    const msg = await prisma.message.findFirst({
      where: { id: params.messageId, orgId: ctx.orgId, direction: "INBOUND" },
      include: { conversation: { include: { channel: true } } },
    });
    if (!msg) throw notFound("Message");
    const media = msg.media as { id?: string } | null;
    if (!media?.id) throw notFound("Media");
    const adapter = adapterFor(msg.conversation.channel.kind);
    if (!adapter.fetchMedia) throw badRequest("This channel does not provide media downloads");
    const file = await adapter.fetchMedia(msg.conversation.channel, media.id);
    const safeType =
      /^(image\/(png|jpeg|webp|gif)|application\/pdf|audio\/[a-z0-9.+-]+|video\/(mp4|3gpp))$/.test(
        file.contentType,
      )
        ? file.contentType
        : "application/octet-stream";
    return new NextResponse(file.body, {
      headers: {
        "content-type": safeType,
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  },
);
