import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { logger, errorMessage } from "@/server/logger";
import { requestIdFrom } from "@/server/http/request";
import { decryptSecret, safeEqual, sha256Hex } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/ratelimit";
import { verifyWhatsAppSignature } from "@/server/channels/whatsappCloud";
import { ingestWebhook } from "@/server/channels/inbound";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ channelId: string }> };

async function loadChannel(channelId: string) {
  if (!/^[a-z0-9]{10,40}$/i.test(channelId)) return null;
  return prisma.channel.findFirst({ where: { id: channelId, kind: "WHATSAPP_CLOUD" } });
}

/** Meta webhook verification handshake (hub.challenge). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { channelId } = await params;
  const channel = await loadChannel(channelId);
  const sp = req.nextUrl.searchParams;
  const token = sp.get("hub.verify_token") ?? "";
  if (
    !channel?.verifyTokenHash ||
    sp.get("hub.mode") !== "subscribe" ||
    !safeEqual(sha256Hex(token), channel.verifyTokenHash)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const challenge = sp.get("hub.challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return new NextResponse("Bad Request", { status: 400 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/**
 * Receives WhatsApp Cloud API events. The signature is verified against the raw body before
 * anything is parsed; valid events are stored durably before we acknowledge with 200.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = requestIdFrom(req.headers);
  const { channelId } = await params;
  const channel = await loadChannel(channelId);
  if (!channel || !channel.encryptedAppSecret || channel.status === "DISABLED")
    return new NextResponse("Not Found", { status: 404 });

  const rl = await rateLimit(`webhook:${channel.id}`, 1200, 60);
  if (!rl.allowed)
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });

  const raw = await req.text();
  if (raw.length > 1_000_000) return new NextResponse("Payload Too Large", { status: 413 });
  if (
    !verifyWhatsAppSignature(
      decryptSecret(channel.encryptedAppSecret),
      raw,
      req.headers.get("x-hub-signature-256"),
    )
  ) {
    logger.warn({ requestId, channelId: channel.id }, "Rejected webhook with invalid signature");
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }
  try {
    const result = await ingestWebhook(channel, raw, payload);
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (err) {
    if (err instanceof Error && err.name === "ZodError") {
      logger.warn({ requestId, channelId: channel.id }, "Webhook payload did not match the expected schema");
      return new NextResponse("Unprocessable", { status: 422 });
    }
    // Non-2xx makes Meta retry delivery, so a transient database failure does not lose the event.
    logger.error({ requestId, channelId: channel.id, err: errorMessage(err) }, "Webhook ingestion failed");
    return new NextResponse("Temporary failure", { status: 500 });
  }
}
