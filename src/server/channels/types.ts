import type { Channel } from "@prisma/client";

export type OutboundPayload =
  | { type: "text"; text: string }
  | { type: "template"; name: string; language: string; bodyParams?: string[] }
  | { type: "buttons"; text: string; buttons: Array<{ id: string; title: string }> }
  | {
      type: "media";
      mediaType: "image" | "document" | "audio" | "video";
      link: string;
      caption?: string;
      filename?: string;
    };

export interface InboundMessage {
  externalId: string;
  from: string;
  profileName: string | null;
  timestamp: Date;
  type: string;
  text: string | null;
  media: { id: string; mimeType?: string; caption?: string; filename?: string; sha256?: string } | null;
  interactive: { kind: string; id: string; title: string } | null;
  contextMessageId: string | null;
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface StatusUpdate {
  externalId: string;
  recipient: string;
  status: DeliveryStatus;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface ParsedWebhook {
  phoneNumberId: string | null;
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

export class ChannelSendError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

export interface ChannelHealth {
  ok: boolean;
  detail: string;
}

export interface MessageTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  body: string | null;
}

/** Contract every messaging channel adapter implements. WhatsApp-specific logic stays inside adapters. */
export interface ChannelAdapter {
  send(channel: Channel, to: string, payload: OutboundPayload): Promise<{ externalId: string }>;
  markRead?(channel: Channel, externalId: string): Promise<void>;
  healthCheck(channel: Channel): Promise<ChannelHealth>;
  listTemplates?(channel: Channel): Promise<MessageTemplate[]>;
  createTemplate?(
    channel: Channel,
    t: { name: string; language: string; category: string; body: string },
  ): Promise<{ id: string; status: string }>;
  fetchMedia?(channel: Channel, mediaId: string): Promise<{ contentType: string; body: ArrayBuffer }>;
}
