import type { Job } from "@prisma/client";
import { markSendDead, sendQueuedMessage } from "../channels/outbound";
import { processInbound, summarizeConversation } from "../agent/engine";
import { indexDocument } from "../knowledge/ingest";
import { deliverWebhook } from "../services/events";
import { runFollowUp } from "../services/followups";
import { runRetentionSweep } from "../services/retention";
import { PermanentJobError } from "./queue";

export class RetryLaterError extends Error {}

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

const str = (p: Record<string, unknown>, k: string): string => {
  const v = p[k];
  if (typeof v !== "string" || !v) throw new PermanentJobError(`Job payload missing "${k}"`);
  return v;
};

export const handlers: Record<string, Handler> = {
  async process_inbound(p, job) {
    const outcome = await processInbound(str(p, "messageId"), {
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });
    if (outcome.status === "RETRY") throw new RetryLaterError(outcome.reason);
  },
  async send_message(p) {
    await sendQueuedMessage(str(p, "messageId"));
  },
  async followup_due(p) {
    await runFollowUp(str(p, "followUpId"));
  },
  async index_document(p, job) {
    await indexDocument(job.orgId ?? str(p, "orgId"), str(p, "documentId"));
  },
  async summarize_conversation(p) {
    await summarizeConversation(str(p, "conversationId"));
  },
  async deliver_webhook(p) {
    await deliverWebhook(p as unknown as Parameters<typeof deliverWebhook>[0]);
  },
  async retention_sweep() {
    await runRetentionSweep();
  },
};

/** Side effects when a job is moved to the dead-letter state. */
export async function onDead(job: Job, error: string) {
  const p = job.payload as Record<string, unknown>;
  if (job.type === "send_message" && typeof p.messageId === "string") await markSendDead(p.messageId, error);
}
