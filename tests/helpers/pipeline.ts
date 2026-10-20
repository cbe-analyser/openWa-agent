import type { Channel } from "@prisma/client";
import { prisma } from "@/server/db";
import { buildSimulatedInbound } from "@/server/channels/simulator";
import { ingestWebhook } from "@/server/channels/inbound";
import { drainJobs } from "@/server/jobs/worker";
import { sha256Hex } from "@/server/security/crypto";
import { indexDocument } from "@/server/knowledge/ingest";

/** Delivers a simulated customer message through the real webhook pipeline. */
export async function customerSays(
  channel: Channel,
  text: string,
  from = "254700000001",
  name = "Test Customer",
) {
  const { id, payload } = buildSimulatedInbound({ phoneNumberId: channel.phoneNumberId!, from, name, text });
  const raw = JSON.stringify(payload);
  await ingestWebhook(channel, raw, payload);
  return prisma.message.findUniqueOrThrow({
    where: { channelId_externalId: { channelId: channel.id, externalId: id } },
  });
}

/** Runs all due jobs (agent processing, sends, webhooks). */
export const runJobs = () => drainJobs();

export async function outbound(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId, direction: "OUTBOUND" },
    orderBy: { createdAt: "asc" },
  });
}

export async function addKnowledge(orgId: string, title: string, text: string) {
  const doc = await prisma.knowledgeDocument.create({
    data: { orgId, title, sourceType: "TEXT", text, contentHash: sha256Hex(text) },
  });
  await indexDocument(orgId, doc.id);
  return doc;
}

export const HOURS_DOC = `Support hours: Monday to Friday from 8:00 to 18:00 and Saturday from 9:00 to 13:00. We are closed on Sundays.
Our shop is at 12 Example Road, Nairobi.`;
