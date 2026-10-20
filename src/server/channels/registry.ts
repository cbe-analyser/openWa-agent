import type { ChannelKind } from "@prisma/client";
import { simulatorAdapter } from "./simulator";
import type { ChannelAdapter } from "./types";
import { whatsappCloudAdapter } from "./whatsappCloud";

const adapters: Record<ChannelKind, ChannelAdapter> = {
  WHATSAPP_CLOUD: whatsappCloudAdapter,
  SIMULATOR: simulatorAdapter,
};

export function adapterFor(kind: ChannelKind): ChannelAdapter {
  return adapters[kind];
}

/** Test hook to substitute an adapter (e.g. to simulate API failures). */
export function setAdapter(kind: ChannelKind, adapter: ChannelAdapter) {
  adapters[kind] = adapter;
}
