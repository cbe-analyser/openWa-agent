import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { hmacSha256Hex } from "@/server/security/crypto";
import { deleteCustomerData, exportCustomerData } from "@/server/services/customers";
import { runRetentionSweep } from "@/server/services/retention";
import { createWebhookEndpoint } from "@/server/services/settings";
import { ctxFor, createOrgWithUser, simulatorChannel } from "../helpers/db";
import { addKnowledge, customerSays, HOURS_DOC, runJobs } from "../helpers/pipeline";
import { fakeServer } from "../helpers/fake-server";

afterEach(() => {
  delete process.env.ALLOW_PRIVATE_NETWORK_FETCH;
  resetEnvCache();
});

async function setup() {
  const t = await createOrgWithUser("OWNER");
  await prisma.organization.update({ where: { id: t.org.id }, data: { autonomyMode: "AUTONOMOUS" } });
  await addKnowledge(t.org.id, "Opening hours", HOURS_DOC);
  return { ...t, channel: await simulatorChannel(t.org.id) };
}

describe("data subject rights", () => {
  it("exports a customer's conversations and messages and audits the export", async () => {
    const { channel, ctx } = await setup();
    const msg = await customerSays(channel, "What are your support hours on Saturday?");
    await runJobs();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });

    const out = await exportCustomerData(ctx, conv.customerId);
    const bodies = out.customer.conversations.flatMap((c) => c.messages.map((m) => m.body));
    expect(bodies).toContain("What are your support hours on Saturday?");
    expect(bodies.length).toBeGreaterThanOrEqual(2); // the customer's message and the AI reply
    expect(await prisma.auditLog.count({ where: { orgId: ctx.orgId, action: "customer.exported" } })).toBe(1);
  });

  it("erases a customer with all their messages; only owners may do it", async () => {
    const { channel, ctx, org } = await setup();
    const msg = await customerSays(channel, "What are your support hours on Saturday?");
    await runJobs();
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });

    await expect(deleteCustomerData(ctxFor(org.id, null, "ADMIN"), conv.customerId)).rejects.toThrow();
    await deleteCustomerData(ctx, conv.customerId);

    expect(await prisma.customer.count({ where: { id: conv.customerId } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: conv.id } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "customer.deleted" } });
    expect(JSON.stringify(audit)).not.toContain("254700000001"); // the number itself is not kept
  });
});

describe("retention", () => {
  it("deletes message content older than the organization's retention period only", async () => {
    const { channel, org } = await setup();
    const old = await customerSays(channel, "What are your support hours on Saturday?");
    await runJobs();
    await prisma.message.updateMany({
      where: { conversationId: old.conversationId },
      data: { createdAt: new Date(Date.now() - 10 * 86400_000) },
    });
    const recent = await customerSays(channel, "Are you open on Sunday?");

    await runRetentionSweep(); // no retention configured: nothing is deleted
    expect(await prisma.message.count({ where: { id: old.id } })).toBe(1);

    await prisma.organization.update({ where: { id: org.id }, data: { retentionDays: 7 } });
    await runRetentionSweep();
    expect(await prisma.message.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.message.count({ where: { id: recent.id } })).toBe(1);
  });
});

describe("outbound webhooks", () => {
  it("delivers subscribed events with a verifiable signature", async () => {
    process.env.ALLOW_PRIVATE_NETWORK_FETCH = "true"; // the receiver listens on localhost
    resetEnvCache();
    const receiver = await fakeServer(() => ({ body: { ok: true } }));
    try {
      const { channel, ctx } = await setup();
      const ep = await createWebhookEndpoint(ctx, {
        url: `${receiver.url}/hooks`,
        events: ["message.received"],
      });
      await customerSays(channel, "What are your support hours on Saturday?");
      await runJobs();

      const deliveries = receiver.requests.filter((r) => r.url === "/hooks");
      expect(deliveries).toHaveLength(1);
      const d = deliveries[0]!;
      expect(d.headers["x-openwa-event"]).toBe("message.received");
      const sig = String(d.headers["x-openwa-signature"]);
      const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=", 2) as [string, string]));
      expect(parts.v1).toBe(hmacSha256Hex(ep.secret, `${parts.t}.${JSON.stringify(d.body)}`));
      expect((d.body as { type: string }).type).toBe("message.received");
    } finally {
      await receiver.close();
    }
  });
});
