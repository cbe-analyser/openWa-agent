import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { executeTool, decideToolExecution } from "@/server/tools/executor";
import { cancelFollowUp, runFollowUp, scheduleFollowUp } from "@/server/services/followups";
import { claimJobs, enqueue, failJob, recoverStaleJobs, retryDeadJob } from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/worker";
import { createChannel, upsertHttpTool } from "@/server/services/settings";
import { queueOutbound, sendQueuedMessage } from "@/server/channels/outbound";
import { getRetriever } from "@/server/knowledge/retrieval";
import { createOrgWithUser, simulatorChannel } from "../helpers/db";
import { addKnowledge, customerSays, HOURS_DOC, outbound, runJobs } from "../helpers/pipeline";
import { fakeServer } from "../helpers/fake-server";

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
  delete process.env.WHATSAPP_GRAPH_BASE_URL;
  delete process.env.ALLOW_PRIVATE_NETWORK_FETCH;
  resetEnvCache();
});

async function conversation() {
  const t = await createOrgWithUser("OWNER");
  const channel = await simulatorChannel(t.org.id);
  const msg = await customerSays(channel, "hello");
  await prisma.organization.update({ where: { id: t.org.id }, data: { aiPaused: true } }); // keep the AI out of these tests
  await runJobs();
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });
  return { ...t, channel, conv };
}

describe("tools framework", () => {
  it("validates input, binds the organization and logs every execution", async () => {
    const { org, conv } = await conversation();
    const ctx = {
      orgId: org.id,
      conversationId: conv.id,
      customerId: conv.customerId,
      agentRunId: null,
      actor: "AI" as const,
      actorId: null,
    };
    const bad = await executeTool("create_ticket", { subject: "" }, ctx);
    expect(bad.status).toBe("FAILED");
    const ok = await executeTool(
      "create_ticket",
      { subject: "Router has red LOS light", description: "Customer reports red light", priority: "HIGH" },
      ctx,
    );
    expect(ok.status).toBe("SUCCEEDED");
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orgId: org.id } });
    expect(ticket.customerId).toBe(conv.customerId);
    expect(await prisma.toolExecution.count({ where: { orgId: org.id } })).toBe(2);
  });

  it("denies unknown and disabled tools and never lets the model choose another tenant", async () => {
    const a = await conversation();
    const b = await conversation();
    const ctx = {
      orgId: a.org.id,
      conversationId: a.conv.id,
      customerId: a.conv.customerId,
      agentRunId: null,
      actor: "AI" as const,
      actorId: null,
    };
    expect((await executeTool("run_shell", { cmd: "ls" }, ctx)).status).toBe("DENIED");
    await prisma.toolConfig.updateMany({
      where: { orgId: a.org.id, name: "create_ticket" },
      data: { enabled: false },
    });
    expect((await executeTool("create_ticket", { subject: "x x x" }, ctx)).status).toBe("DENIED");
    const bTicket = await prisma.ticket.create({
      data: { orgId: b.org.id, subject: "Beta private", customerId: b.conv.customerId },
    });
    const lookup = await executeTool("get_ticket_status", { ticket_number: bTicket.number }, ctx);
    expect(JSON.stringify(lookup)).not.toContain("Beta private");
  });

  it("holds high-impact HTTP tools for human approval and runs them only after approval", async () => {
    const api = await fakeServer(() => ({ body: { refund_id: "rf_1", status: "issued" } }));
    closers.push(api.close);
    process.env.ALLOW_PRIVATE_NETWORK_FETCH = "true"; // the fake API listens on localhost
    resetEnvCache();
    const { org, conv, user, ctx: userCtx } = await conversation();
    await upsertHttpTool(userCtx, {
      name: "issue_refund",
      description: "Issue a refund for an order in the billing system",
      permission: "HIGH_IMPACT",
      config: {
        method: "POST",
        urlTemplate: `${api.url}/refunds`,
        authHeaderName: "Authorization",
        inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
      },
      secret: "Bearer test-not-real",
    });
    const ctx = {
      orgId: org.id,
      conversationId: conv.id,
      customerId: conv.customerId,
      agentRunId: null,
      actor: "AI" as const,
      actorId: null,
    };
    const pending = await executeTool("issue_refund", { order_id: "A1" }, ctx);
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(api.requests).toHaveLength(0);
    const done = await decideToolExecution(org.id, pending.executionId!, true, user.id);
    expect(done?.status).toBe("SUCCEEDED");
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.headers.authorization).toBe("Bearer test-not-real");
    const exec = await prisma.toolExecution.findUniqueOrThrow({ where: { id: pending.executionId! } });
    expect(exec.status).toBe("APPROVED");
    expect(exec.decidedById).toBe(user.id);
  });
});

describe("follow-ups", () => {
  it("are deduplicated, cancellable and audited", async () => {
    const { org, conv } = await conversation();
    const due = new Date(Date.now() + 2 * 3600_000);
    const a = await scheduleFollowUp({
      orgId: org.id,
      conversationId: conv.id,
      kind: "CHECK_IN",
      dueAt: due,
      createdBy: "USER",
    });
    const b = await scheduleFollowUp({
      orgId: org.id,
      conversationId: conv.id,
      kind: "CHECK_IN",
      dueAt: new Date(due.getTime() + 60_000),
      createdBy: "AI",
    });
    expect(b.id).toBe(a.id);
    await cancelFollowUp(org.id, a.id, { type: "SYSTEM", id: null });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");
    expect(await prisma.job.count({ where: { dedupeKey: `followup:${a.id}`, status: "PENDING" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { targetId: a.id } })).toBeGreaterThanOrEqual(2);
  });

  it("sends inside the 24-hour window, needs a template outside it, and respects opt-out", async () => {
    const { org, conv } = await conversation();
    await prisma.organization.update({ where: { id: org.id }, data: { aiPaused: false } });
    const f1 = await scheduleFollowUp({
      orgId: org.id,
      conversationId: conv.id,
      kind: "REMINDER",
      dueAt: new Date(),
      createdBy: "USER",
      message: "Your technician arrives at 10:00.",
    });
    await runFollowUp(f1.id);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f1.id } })).status).toBe("SENT");

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastInboundAt: new Date(Date.now() - 30 * 3600_000) },
    });
    const f2 = await scheduleFollowUp({
      orgId: org.id,
      conversationId: conv.id,
      kind: "REMINDER",
      dueAt: new Date(Date.now() + 3 * 3600_000),
      createdBy: "USER",
    });
    await runFollowUp(f2.id);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f2.id } })).status).toBe("SKIPPED");

    await prisma.organization.update({
      where: { id: org.id },
      data: { followUpTemplateName: "support_follow_up" },
    });
    const f3 = await scheduleFollowUp({
      orgId: org.id,
      conversationId: conv.id,
      kind: "REMINDER",
      dueAt: new Date(Date.now() + 5 * 3600_000),
      createdBy: "USER",
    });
    await runFollowUp(f3.id);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f3.id } })).status).toBe("SENT");
    const tpl = (await outbound(conv.id)).find((m) => m.type === "template");
    expect(tpl).toBeDefined();

    await prisma.customer.update({ where: { id: conv.customerId }, data: { optedOut: true } });
    await expect(
      scheduleFollowUp({
        orgId: org.id,
        conversationId: conv.id,
        kind: "CHECK_IN",
        dueAt: new Date(Date.now() + 7 * 3600_000),
        createdBy: "USER",
      }),
    ).rejects.toThrow(/opted out/);
  });
});

describe("durable job queue", () => {
  it("dedupes, retries with backoff, dead-letters and can be retried", async () => {
    const { org } = await createOrgWithUser("OWNER");
    expect(await enqueue("noop_test", {}, { orgId: org.id, dedupeKey: "k1", maxAttempts: 2 })).toBe(true);
    expect(await enqueue("noop_test", {}, { orgId: org.id, dedupeKey: "k1", maxAttempts: 2 })).toBe(false);
    let [job] = await claimJobs("w1", 5);
    expect(job!.attempts).toBe(1);
    expect(await failJob(job!, "boom")).toBe("PENDING");
    const retry = await prisma.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(retry.runAt.getTime()).toBeGreaterThan(Date.now() + 3000);
    await prisma.job.update({ where: { id: job!.id }, data: { runAt: new Date() } });
    [job] = await claimJobs("w1", 5);
    expect(await failJob(job!, "boom again")).toBe("DEAD");
    expect(await retryDeadJob(org.id, job!.id)).toBeTruthy();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("PENDING");
  });

  it("unknown job types are dead-lettered instead of looping", async () => {
    await enqueue("does_not_exist", {}, { maxAttempts: 5 });
    await drainJobs();
    expect((await prisma.job.findFirstOrThrow({ where: { type: "does_not_exist" } })).status).toBe("DEAD");
  });

  it("recovers jobs whose worker crashed mid-run", async () => {
    await enqueue("noop_test", {}, {});
    const [job] = await claimJobs("crashed-worker", 1);
    await prisma.job.update({
      where: { id: job!.id },
      data: { lockedAt: new Date(Date.now() - 20 * 60_000) },
    });
    expect(await recoverStaleJobs()).toBe(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("PENDING");
  });
});

describe("WhatsApp Cloud API sending (stubbed Graph API)", () => {
  async function cloudConversation(graph: (url: string) => { status?: number; body: unknown }) {
    const srv = await fakeServer((r) => graph(r.url));
    closers.push(srv.close);
    process.env.WHATSAPP_GRAPH_BASE_URL = srv.url;
    resetEnvCache();
    const { ctx, org } = await createOrgWithUser("OWNER", { sandbox: false });
    const channel = await createChannel(ctx, {
      kind: "WHATSAPP_CLOUD",
      name: "WA",
      phoneNumberId: "555000111",
      accessToken: "test-token-not-real-0000000",
      appSecret: "test-secret-not-real",
      verifyToken: "test-verify-token-0000",
    });
    const customer = await prisma.customer.create({ data: { orgId: org.id, waId: "254700000005" } });
    const conv = await prisma.conversation.create({
      data: { orgId: org.id, channelId: channel.id, customerId: customer.id, lastInboundAt: new Date() },
    });
    return { srv, org, conv, channel };
  }
  const queue = (orgId: string, conversationId: string, channelId: string) =>
    prisma.$transaction((tx) =>
      queueOutbound(tx, {
        orgId,
        conversationId,
        channelId,
        authorType: "HUMAN",
        payload: { type: "text", text: "Hello from the team" },
      }),
    );

  it("sends with the bearer token and stores the WhatsApp message id", async () => {
    const { srv, org, conv, channel } = await cloudConversation(() => ({
      body: { messages: [{ id: "wamid.OUT1" }] },
    }));
    const msg = await queue(org.id, conv.id, channel.id);
    await sendQueuedMessage(msg.id);
    const sent = await prisma.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.externalId).toBe("wamid.OUT1");
    expect(srv.requests[0]!.url).toBe("/v21.0/555000111/messages");
    expect(srv.requests[0]!.headers.authorization).toBe("Bearer test-token-not-real-0000000");
  });

  it("does not retry permanent errors such as a closed 24-hour window", async () => {
    const { org, conv, channel } = await cloudConversation(() => ({
      status: 400,
      body: { error: { code: 131047, message: "Re-engagement message" } },
    }));
    const msg = await queue(org.id, conv.id, channel.id);
    await expect(sendQueuedMessage(msg.id)).rejects.toThrow();
    const failed = await prisma.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("WINDOW_CLOSED");
  });

  it("re-queues on transient errors so the job retries", async () => {
    const { org, conv, channel } = await cloudConversation(() => ({
      status: 503,
      body: { error: { code: 1, message: "unavailable" } },
    }));
    const msg = await queue(org.id, conv.id, channel.id);
    await expect(sendQueuedMessage(msg.id)).rejects.toThrow();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("QUEUED");
  });

  it("refuses free-form messages outside the 24-hour window without calling the API", async () => {
    const { srv, org, conv, channel } = await cloudConversation(() => ({
      body: { messages: [{ id: "x" }] },
    }));
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const msg = await queue(org.id, conv.id, channel.id);
    await sendQueuedMessage(msg.id);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).errorCode).toBe(
      "WINDOW_CLOSED",
    );
    expect(srv.requests).toHaveLength(0);
  });
});

describe("knowledge retrieval", () => {
  it("finds relevant passages and reports insufficient evidence for unrelated questions", async () => {
    const { org } = await createOrgWithUser("OWNER");
    await addKnowledge(org.id, "Opening hours", HOURS_DOC);
    await addKnowledge(
      org.id,
      "Router guide",
      "If the LOS light on the router is red, the fibre signal is lost and a technician must visit. Restarting will not help.",
    );
    const r1 = await getRetriever().search(org.id, "my router LOS light is red", 3);
    expect(r1.sufficientEvidence).toBe(true);
    expect(r1.chunks[0]!.documentTitle).toBe("Router guide");
    const r2 = await getRetriever().search(org.id, "quantum cryptography satellites", 3);
    expect(r2.sufficientEvidence).toBe(false);
  });
});

describe("database migrations", () => {
  it("installed pgvector and the knowledge search indexes", async () => {
    const ext = await prisma.$queryRaw<
      Array<{ extname: string }>
    >`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(ext).toHaveLength(1);
    const idx = await prisma.$queryRaw<
      Array<{ indexname: string }>
    >`SELECT indexname FROM pg_indexes WHERE tablename = 'KnowledgeChunk'`;
    expect(idx.map((i) => i.indexname).join(",")).toMatch(/tsv/i);
  });
});
