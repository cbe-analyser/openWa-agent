import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as conversationsRoute from "@/app/api/v1/conversations/route";
import * as conversationRoute from "@/app/api/v1/conversations/[id]/route";
import * as conversationAction from "@/app/api/v1/conversations/[id]/[action]/route";
import * as customersRoute from "@/app/api/v1/customers/route";
import * as customerRoute from "@/app/api/v1/customers/[id]/route";
import * as ticketsRoute from "@/app/api/v1/tickets/route";
import * as ticketRoute from "@/app/api/v1/tickets/[id]/route";
import * as docRoute from "@/app/api/v1/knowledge/documents/[id]/route";
import * as searchRoute from "@/app/api/v1/knowledge/search/route";
import * as simulatorRoute from "@/app/api/v1/simulator/[channelId]/route";
import * as providerRoute from "@/app/api/v1/settings/providers/[id]/route";
import { createApiKey } from "@/server/services/settings";
import { createOrgWithUser, sessionCookie, simulatorChannel } from "../helpers/db";
import { addKnowledge, customerSays, runJobs } from "../helpers/pipeline";
import { call } from "../helpers/http";

async function tenant(name: string) {
  const t = await createOrgWithUser("OWNER", { name });
  const channel = await simulatorChannel(t.org.id);
  const msg = await customerSays(
    channel,
    `Hello from ${name}`,
    name === "Alpha" ? "254711111111" : "254722222222",
  );
  await runJobs();
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });
  const ticket = await prisma.ticket.create({
    data: {
      orgId: t.org.id,
      subject: `${name} ticket`,
      customerId: conv.customerId,
      conversationId: conv.id,
    },
  });
  const doc = await addKnowledge(
    t.org.id,
    `${name} secret pricing`,
    `${name} internal price list: the ${name} plan costs 999 shillings per month for members.`,
  );
  const provider = await prisma.aIProviderConfig.findFirstOrThrow({ where: { orgId: t.org.id } });
  return { ...t, channel, conv, ticket, doc, provider, cookie: await sessionCookie(t.user.id, t.org.id) };
}

describe("multi-tenant isolation", () => {
  it("a user of one organization cannot read or change another organization's data", async () => {
    const a = await tenant("Alpha");
    const b = await tenant("Beta");

    // Lists only contain own data.
    const list = await call(conversationsRoute.GET, { cookie: a.cookie, path: "/api/v1/conversations" });
    expect(list.status).toBe(200);
    expect(list.json.items!.map((c) => c.id)).toEqual([a.conv.id]);
    const customers = await call(customersRoute.GET, { cookie: a.cookie, path: "/api/v1/customers" });
    expect(customers.json.items!.every((c) => c.id === a.conv.customerId)).toBe(true);
    const tickets = await call(ticketsRoute.GET, { cookie: a.cookie, path: "/api/v1/tickets" });
    expect(tickets.json.items!.map((t) => t.id)).toEqual([a.ticket.id]);

    // Direct access by id is denied as not found (no existence leak).
    expect((await call(conversationRoute.GET, { cookie: a.cookie, params: { id: b.conv.id } })).status).toBe(
      404,
    );
    expect(
      (await call(customerRoute.GET, { cookie: a.cookie, params: { id: b.conv.customerId } })).status,
    ).toBe(404);
    expect((await call(ticketRoute.GET, { cookie: a.cookie, params: { id: b.ticket.id } })).status).toBe(404);
    expect((await call(docRoute.GET, { cookie: a.cookie, params: { id: b.doc.id } })).status).toBe(404);

    // Mutations are denied and leave the other tenant untouched.
    expect(
      (
        await call(conversationAction.POST, {
          method: "POST",
          cookie: a.cookie,
          params: { id: b.conv.id, action: "takeover" },
          body: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(customerRoute.DELETE, {
          method: "DELETE",
          cookie: a.cookie,
          params: { id: b.conv.customerId },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(providerRoute.DELETE, {
          method: "DELETE",
          cookie: a.cookie,
          params: { id: b.provider.id },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(simulatorRoute.POST, {
          method: "POST",
          cookie: a.cookie,
          params: { channelId: b.channel.id },
          body: { from: "254733333333", name: "X", text: "hi" },
        })
      ).status,
    ).toBe(404);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: b.conv.id } })).control).toBe(
      b.conv.control,
    );
    expect(await prisma.customer.count({ where: { id: b.conv.customerId } })).toBe(1);
    expect(await prisma.aIProviderConfig.count({ where: { id: b.provider.id } })).toBe(1);

    // Knowledge retrieval never returns another tenant's documents.
    const search = await call(searchRoute.POST, {
      method: "POST",
      cookie: a.cookie,
      body: { query: "Beta internal price list plan" },
    });
    expect(search.status).toBe(200);
    const chunks = (search.json as unknown as { chunks: Array<{ documentId: string }> }).chunks;
    expect(chunks.every((c) => c.documentId !== b.doc.id)).toBe(true);
  });

  it("an API key is scoped to its own organization", async () => {
    const a = await tenant("Alpha");
    const b = await tenant("Beta");
    const { key } = await createApiKey(
      { ...a.ctx, kind: "session" },
      { name: "integration", scopes: ["conversations:read", "customers:read", "tickets:read"] },
    );
    expect((await call(conversationRoute.GET, { bearer: key, params: { id: a.conv.id } })).status).toBe(200);
    expect((await call(conversationRoute.GET, { bearer: key, params: { id: b.conv.id } })).status).toBe(404);
    expect((await call(customerRoute.GET, { bearer: key, params: { id: b.conv.customerId } })).status).toBe(
      404,
    );
    const list = await call(conversationsRoute.GET, { bearer: key, path: "/api/v1/conversations" });
    expect(list.json.items!.map((c) => c.id)).toEqual([a.conv.id]);
  });

  it("a session cannot act on an organization it is not a member of by switching", async () => {
    const a = await tenant("Alpha");
    const b = await tenant("Beta");
    const { switchOrganization } = await import("@/server/services/auth");
    await expect(switchOrganization(a.ctx, b.org.id)).rejects.toThrow();
  });
});
