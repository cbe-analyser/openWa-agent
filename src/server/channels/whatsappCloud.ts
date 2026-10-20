import type { Channel } from "@prisma/client";
import { z } from "zod";
import { env } from "../env";
import { decryptSecret, hmacSha256Hex, safeEqual } from "../security/crypto";
import {
  ChannelSendError,
  type ChannelAdapter,
  type ChannelHealth,
  type InboundMessage,
  type MessageTemplate,
  type OutboundPayload,
  type ParsedWebhook,
  type StatusUpdate,
} from "./types";

/**
 * WhatsApp Business Platform — Cloud API adapter (official Meta Graph API).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

// Graph API error codes that will not succeed on retry.
const PERMANENT_ERROR_CODES: Record<string, string> = {
  "131047": "WINDOW_CLOSED", // re-engagement: more than 24h since the customer last wrote; use a template
  "131026": "UNDELIVERABLE",
  "131051": "UNSUPPORTED_TYPE",
  "132000": "TEMPLATE_PARAM_MISMATCH",
  "132001": "TEMPLATE_NOT_FOUND",
  "131009": "INVALID_PARAMETER",
  "100": "INVALID_PARAMETER",
  "190": "TOKEN_INVALID",
  "10": "PERMISSION_DENIED",
  "200": "PERMISSION_DENIED",
  "131031": "ACCOUNT_LOCKED",
};
const RATE_LIMIT_CODES = new Set(["4", "80007", "130429", "131048", "131056", "133016"]);

function graphBase() {
  return env().WHATSAPP_GRAPH_BASE_URL.replace(/\/+$/, "");
}

function accessToken(channel: Channel): string {
  if (!channel.encryptedAccessToken)
    throw new ChannelSendError("WhatsApp access token is not configured", false, "NOT_CONFIGURED");
  return decryptSecret(channel.encryptedAccessToken);
}

async function graphRequest(
  channel: Channel,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
) {
  const url = new URL(`${graphBase()}/${channel.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${accessToken(channel)}`, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ChannelSendError(`WhatsApp API unreachable: ${(err as Error).message}`, true, "NETWORK");
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = (data.error ?? {}) as { message?: string; code?: number; error_subcode?: number };
    const code = String(err.code ?? res.status);
    const retryable = res.status >= 500 || res.status === 429 || RATE_LIMIT_CODES.has(code);
    const mapped =
      PERMANENT_ERROR_CODES[code] ?? (RATE_LIMIT_CODES.has(code) ? "RATE_LIMITED" : `GRAPH_${code}`);
    throw new ChannelSendError(
      `WhatsApp API error ${code}: ${err.message ?? res.statusText}`,
      retryable && !PERMANENT_ERROR_CODES[code],
      mapped,
    );
  }
  return data;
}

export function buildMessageBody(to: string, payload: OutboundPayload): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (payload.type) {
    case "text":
      return { ...base, type: "text", text: { body: payload.text.slice(0, 4096), preview_url: false } };
    case "template":
      return {
        ...base,
        type: "template",
        template: {
          name: payload.name,
          language: { code: payload.language },
          ...(payload.bodyParams?.length
            ? {
                components: [
                  { type: "body", parameters: payload.bodyParams.map((t) => ({ type: "text", text: t })) },
                ],
              }
            : {}),
        },
      };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: payload.text.slice(0, 1024) },
          action: {
            buttons: payload.buttons.slice(0, 3).map((b) => ({
              type: "reply",
              reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
            })),
          },
        },
      };
    case "media":
      return {
        ...base,
        type: payload.mediaType,
        [payload.mediaType]: {
          link: payload.link,
          ...(payload.caption && payload.mediaType !== "audio" ? { caption: payload.caption } : {}),
          ...(payload.filename && payload.mediaType === "document" ? { filename: payload.filename } : {}),
        },
      };
  }
}

export const whatsappCloudAdapter: ChannelAdapter = {
  async send(channel, to, payload) {
    if (!channel.phoneNumberId)
      throw new ChannelSendError("Phone number ID is not configured", false, "NOT_CONFIGURED");
    const data = await graphRequest(channel, `${channel.phoneNumberId}/messages`, {
      method: "POST",
      body: buildMessageBody(to, payload),
    });
    const id = (data.messages as Array<{ id: string }> | undefined)?.[0]?.id;
    if (!id)
      throw new ChannelSendError("WhatsApp API response did not include a message id", true, "NO_MESSAGE_ID");
    return { externalId: id };
  },

  async markRead(channel, externalId) {
    await graphRequest(channel, `${channel.phoneNumberId}/messages`, {
      method: "POST",
      body: { messaging_product: "whatsapp", status: "read", message_id: externalId },
    });
  },

  async healthCheck(channel): Promise<ChannelHealth> {
    try {
      const data = await graphRequest(channel, `${channel.phoneNumberId}`, {
        query: { fields: "display_phone_number,verified_name,quality_rating" },
      });
      return {
        ok: true,
        detail:
          `${data.verified_name ?? ""} ${data.display_phone_number ?? ""} quality=${data.quality_rating ?? "n/a"}`.trim(),
      };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  },

  async listTemplates(channel): Promise<MessageTemplate[]> {
    if (!channel.wabaId)
      throw new ChannelSendError("WhatsApp Business Account ID is not configured", false, "NOT_CONFIGURED");
    const data = await graphRequest(channel, `${channel.wabaId}/message_templates`, {
      query: { fields: "name,status,language,category,components", limit: "100" },
    });
    return ((data.data as Array<Record<string, unknown>>) ?? []).map((t) => ({
      name: String(t.name),
      language: String(t.language),
      status: String(t.status),
      category: String(t.category),
      body:
        ((t.components as Array<{ type: string; text?: string }> | undefined) ?? []).find(
          (c) => c.type === "BODY",
        )?.text ?? null,
    }));
  },

  async createTemplate(channel, t) {
    if (!channel.wabaId)
      throw new ChannelSendError("WhatsApp Business Account ID is not configured", false, "NOT_CONFIGURED");
    const data = await graphRequest(channel, `${channel.wabaId}/message_templates`, {
      method: "POST",
      body: {
        name: t.name,
        language: t.language,
        category: t.category,
        components: [{ type: "BODY", text: t.body }],
      },
    });
    return { id: String(data.id), status: String(data.status ?? "PENDING") };
  },

  async fetchMedia(channel, mediaId) {
    const meta = await graphRequest(channel, mediaId);
    const url = String(meta.url ?? "");
    if (!url.startsWith("https://"))
      throw new ChannelSendError("Media URL missing", false, "MEDIA_NOT_FOUND");
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken(channel)}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok)
      throw new ChannelSendError(
        `Media download failed: HTTP ${res.status}`,
        res.status >= 500,
        "MEDIA_DOWNLOAD",
      );
    return {
      contentType: res.headers.get("content-type") ?? String(meta.mime_type ?? "application/octet-stream"),
      body: await res.arrayBuffer(),
    };
  },
};

/** Validates X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the Meta app secret). */
export function verifyWhatsAppSignature(
  appSecret: string,
  rawBody: string | Buffer,
  header: string | null,
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
  return safeEqual(expected, header);
}

// ---- Webhook payload parsing (validated with zod; unknown fields are ignored) -------------

const messageSchema = z
  .object({
    id: z.string().min(1).max(200),
    from: z.string().min(3).max(32),
    timestamp: z.string().regex(/^\d+$/),
    type: z.string().max(32),
    text: z.object({ body: z.string().max(10_000) }).optional(),
    image: z
      .object({
        id: z.string(),
        mime_type: z.string().optional(),
        caption: z.string().optional(),
        sha256: z.string().optional(),
      })
      .optional(),
    document: z
      .object({
        id: z.string(),
        mime_type: z.string().optional(),
        caption: z.string().optional(),
        filename: z.string().optional(),
        sha256: z.string().optional(),
      })
      .optional(),
    audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
    video: z
      .object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() })
      .optional(),
    sticker: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
    button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
        list_reply: z
          .object({ id: z.string(), title: z.string(), description: z.string().optional() })
          .optional(),
      })
      .optional(),
    context: z.object({ id: z.string().optional() }).optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string(),
    status: z.enum(["sent", "delivered", "read", "failed", "deleted", "warning"]),
    timestamp: z.string(),
    recipient_id: z.string(),
    errors: z
      .array(z.object({ code: z.number(), title: z.string().optional(), message: z.string().optional() }))
      .optional(),
  })
  .passthrough();

const webhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z
            .object({
              messaging_product: z.string().optional(),
              metadata: z
                .object({ phone_number_id: z.string(), display_phone_number: z.string().optional() })
                .optional(),
              contacts: z
                .array(
                  z.object({
                    wa_id: z.string(),
                    profile: z.object({ name: z.string().optional() }).optional(),
                  }),
                )
                .optional(),
              messages: z.array(z.unknown()).optional(),
              statuses: z.array(z.unknown()).optional(),
            })
            .passthrough(),
        }),
      ),
    }),
  ),
});

export function parseWhatsAppWebhook(payload: unknown): ParsedWebhook {
  const parsed = webhookSchema.parse(payload);
  const out: ParsedWebhook = { phoneNumberId: null, messages: [], statuses: [] };
  if (parsed.object !== "whatsapp_business_account") return out;
  for (const entry of parsed.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const v = change.value;
      out.phoneNumberId = v.metadata?.phone_number_id ?? out.phoneNumberId;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const raw of v.messages ?? []) {
        const r = messageSchema.safeParse(raw);
        if (!r.success) continue;
        const m = r.data;
        const media = m.image ?? m.document ?? m.audio ?? m.video ?? m.sticker ?? null;
        let text: string | null = m.text?.body ?? null;
        let interactive: InboundMessage["interactive"] = null;
        if (m.interactive?.button_reply) {
          interactive = { kind: "button_reply", ...m.interactive.button_reply };
          text = m.interactive.button_reply.title;
        } else if (m.interactive?.list_reply) {
          interactive = {
            kind: "list_reply",
            id: m.interactive.list_reply.id,
            title: m.interactive.list_reply.title,
          };
          text = m.interactive.list_reply.title;
        } else if (m.button) {
          interactive = {
            kind: "template_button",
            id: m.button.payload ?? m.button.text,
            title: m.button.text,
          };
          text = m.button.text;
        } else if (m.location) {
          text =
            `[Location] ${m.location.name ?? ""} ${m.location.address ?? ""} (${m.location.latitude}, ${m.location.longitude})`.trim();
        }
        const caption = (m.image ?? m.document ?? m.video)?.caption;
        if (!text && caption) text = caption;
        out.messages.push({
          externalId: m.id,
          from: m.from,
          profileName: names.get(m.from) ?? null,
          timestamp: new Date(Number(m.timestamp) * 1000),
          type: m.type,
          text,
          media: media
            ? {
                id: media.id,
                mimeType: media.mime_type,
                caption: "caption" in media ? (media.caption as string | undefined) : undefined,
                filename: "filename" in media ? (media.filename as string | undefined) : undefined,
              }
            : null,
          interactive,
          contextMessageId: m.context?.id ?? null,
        });
      }
      for (const raw of v.statuses ?? []) {
        const r = statusSchema.safeParse(raw);
        if (!r.success || r.data.status === "deleted" || r.data.status === "warning") continue;
        const s = r.data;
        const update: StatusUpdate = {
          externalId: s.id,
          recipient: s.recipient_id,
          status: s.status as StatusUpdate["status"],
          timestamp: new Date(Number(s.timestamp) * 1000),
        };
        if (s.errors?.[0]) {
          update.errorCode = String(s.errors[0].code);
          update.errorMessage = s.errors[0].message ?? s.errors[0].title;
        }
        out.statuses.push(update);
      }
    }
  }
  return out;
}
