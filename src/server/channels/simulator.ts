import { randomBytes } from "node:crypto";
import type { ChannelAdapter } from "./types";

/**
 * Development simulator: behaves like a WhatsApp channel without contacting Meta.
 * Outbound messages are accepted locally and immediately reported as delivered, so the whole
 * pipeline (agent, approvals, statuses, follow-ups) can be exercised without credentials.
 */
export const simulatorAdapter: ChannelAdapter = {
  async send() {
    return { externalId: `wamid.SIM${randomBytes(12).toString("hex")}` };
  },
  async markRead() {},
  async healthCheck() {
    return { ok: true, detail: "Simulator channel (no messages leave this server)" };
  },
  async listTemplates() {
    return [
      {
        name: "follow_up_check_in",
        language: "en",
        status: "APPROVED",
        category: "UTILITY",
        body: "Hi {{1}}, we're checking in on your recent support request. Reply here if you still need help.",
      },
    ];
  },
};

/** Builds a payload in the exact WhatsApp Cloud API webhook shape, so simulated traffic uses the real parser. */
export function buildSimulatedInbound(opts: {
  phoneNumberId: string;
  from: string;
  name: string;
  text?: string;
  buttonReply?: { id: string; title: string };
}) {
  const id = `wamid.SIMIN${randomBytes(12).toString("hex")}`;
  const message: Record<string, unknown> = {
    id,
    from: opts.from,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(opts.buttonReply
      ? { type: "interactive", interactive: { type: "button_reply", button_reply: opts.buttonReply } }
      : { type: "text", text: { body: opts.text ?? "" } }),
  };
  return {
    id,
    payload: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "SIMULATOR",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: opts.phoneNumberId, display_phone_number: "SIMULATOR" },
                contacts: [{ wa_id: opts.from, profile: { name: opts.name } }],
                messages: [message],
              },
            },
          ],
        },
      ],
    },
  };
}
