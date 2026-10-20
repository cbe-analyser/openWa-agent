import { describe, expect, it } from "vitest";
import {
  buildMessageBody,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
} from "@/server/channels/whatsappCloud";
import { buildSimulatedInbound } from "@/server/channels/simulator";
import { isWithinServiceWindow, SERVICE_WINDOW_MS } from "@/server/channels/outbound";
import { hmacSha256Hex } from "@/server/security/crypto";

describe("webhook signature verification", () => {
  const secret = "test-app-secret-0123456789";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  it("accepts a valid X-Hub-Signature-256", () => {
    expect(verifyWhatsAppSignature(secret, body, `sha256=${hmacSha256Hex(secret, body)}`)).toBe(true);
  });
  it("rejects missing, malformed or wrong signatures", () => {
    expect(verifyWhatsAppSignature(secret, body, null)).toBe(false);
    expect(verifyWhatsAppSignature(secret, body, "md5=abc")).toBe(false);
    expect(verifyWhatsAppSignature(secret, body, `sha256=${hmacSha256Hex("other-secret", body)}`)).toBe(
      false,
    );
    expect(verifyWhatsAppSignature(secret, body + " ", `sha256=${hmacSha256Hex(secret, body)}`)).toBe(false);
  });
});

describe("webhook parsing", () => {
  it("parses text messages with contact names", () => {
    const { payload, id } = buildSimulatedInbound({
      phoneNumberId: "123",
      from: "254700000001",
      name: "Wanjiru",
      text: "Hello",
    });
    const p = parseWhatsAppWebhook(payload);
    expect(p.phoneNumberId).toBe("123");
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]).toMatchObject({
      externalId: id,
      from: "254700000001",
      profileName: "Wanjiru",
      text: "Hello",
      type: "text",
    });
  });
  it("parses interactive replies, media and statuses, and skips invalid entries", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123" },
                messages: [
                  {
                    id: "m1",
                    from: "2547",
                    timestamp: "1700000000",
                    type: "interactive",
                    interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } },
                  },
                  {
                    id: "m2",
                    from: "2547",
                    timestamp: "1700000001",
                    type: "image",
                    image: { id: "media-1", mime_type: "image/jpeg", caption: "router lights" },
                  },
                  { id: "bad", timestamp: "x" },
                ],
                statuses: [
                  { id: "out-1", status: "delivered", timestamp: "1700000002", recipient_id: "2547" },
                  {
                    id: "out-2",
                    status: "failed",
                    timestamp: "1700000003",
                    recipient_id: "2547",
                    errors: [{ code: 131047, title: "Re-engagement message" }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const p = parseWhatsAppWebhook(payload);
    expect(p.messages.map((m) => m.externalId)).toEqual(["m1", "m2"]);
    expect(p.messages[0]!.interactive).toEqual({ kind: "button_reply", id: "yes", title: "Yes" });
    expect(p.messages[1]!.media?.id).toBe("media-1");
    expect(p.messages[1]!.text).toBe("router lights");
    expect(p.statuses).toHaveLength(2);
    expect(p.statuses[1]).toMatchObject({ status: "failed", errorCode: "131047" });
  });
  it("ignores other webhook objects", () => {
    expect(parseWhatsAppWebhook({ object: "page", entry: [] }).messages).toEqual([]);
  });
});

describe("outbound payloads", () => {
  it("builds text, interactive and template bodies", () => {
    expect(buildMessageBody("2547", { type: "text", text: "hi" })).toMatchObject({
      messaging_product: "whatsapp",
      to: "2547",
      type: "text",
      text: { body: "hi" },
    });
    const b = buildMessageBody("2547", {
      type: "buttons",
      text: "Fixed?",
      buttons: [
        { id: "yes", title: "Yes" },
        { id: "no", title: "No" },
      ],
    });
    expect(b).toMatchObject({ type: "interactive" });
    const t = buildMessageBody("2547", {
      type: "template",
      name: "follow_up",
      language: "en",
      bodyParams: ["Amina"],
    });
    expect(t).toMatchObject({ type: "template", template: { name: "follow_up", language: { code: "en" } } });
  });
});

describe("24-hour customer service window", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("is open within 24 hours of the last inbound message", () => {
    expect(isWithinServiceWindow(new Date(now.getTime() - SERVICE_WINDOW_MS + 60_000), now)).toBe(true);
  });
  it("is closed after 24 hours or with no inbound message", () => {
    expect(isWithinServiceWindow(new Date(now.getTime() - SERVICE_WINDOW_MS - 1), now)).toBe(false);
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });
});
