import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as conversationsRoute from "@/app/api/v1/conversations/route";
import * as ticketsRoute from "@/app/api/v1/tickets/route";
import * as apiKeysRoute from "@/app/api/v1/api-keys/route";
import * as rotateRoute from "@/app/api/v1/api-keys/[id]/rotate/route";
import * as settingsAgent from "@/app/api/v1/settings/agent/route";
import * as providersRoute from "@/app/api/v1/settings/providers/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as webhookRoute from "@/app/api/webhooks/whatsapp/[channelId]/route";
import * as openapiRoute from "@/app/api/v1/openapi.json/route";
import { createApiKey, createChannel, revokeApiKey } from "@/server/services/settings";
import { rateLimit } from "@/server/security/ratelimit";
import { hmacSha256Hex } from "@/server/security/crypto";
import { buildSimulatedInbound } from "@/server/channels/simulator";
import { createOrgWithUser, ctxFor, sessionCookie, TEST_PASSWORD } from "../helpers/db";
import { call } from "../helpers/http";

describe("API keys", () => {
  it("authenticates, enforces scopes, and stops working after revocation or expiry", async () => {
    const { ctx } = await createOrgWithUser("OWNER");
    const created = await createApiKey(ctx, { name: "reader", scopes: ["conversations:read"] });
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).not.toBe(created.key);
    expect(JSON.stringify(stored)).not.toContain(created.key);

    expect(
      (await call(conversationsRoute.GET, { bearer: created.key, path: "/api/v1/conversations" })).status,
    ).toBe(200);
    // Missing scope → 403
    expect((await call(ticketsRoute.GET, { bearer: created.key, path: "/api/v1/tickets" })).status).toBe(403);
    // Session-only endpoints reject API keys
    expect((await call(apiKeysRoute.GET, { bearer: created.key })).status).toBe(401);
    expect((await call(settingsAgent.GET, { bearer: created.key })).status).toBe(401);
    // Wrong key → 401
    expect((await call(conversationsRoute.GET, { bearer: created.key.slice(0, -2) + "zz" })).status).toBe(
      401,
    );

    await revokeApiKey(ctx, created.id);
    expect((await call(conversationsRoute.GET, { bearer: created.key })).status).toBe(401);

    const expiring = await createApiKey(ctx, {
      name: "short",
      scopes: ["conversations:read"],
      expiresInDays: 1,
    });
    await prisma.apiKey.update({
      where: { id: expiring.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call(conversationsRoute.GET, { bearer: expiring.key })).status).toBe(401);
  });

  it("can only be created from the dashboard, returns the secret once, and rotates", async () => {
    const { user, org } = await createOrgWithUser("OWNER");
    const cookie = await sessionCookie(user.id, org.id);
    const res = await call(apiKeysRoute.POST, {
      method: "POST",
      cookie,
      body: { name: "crm", scopes: ["conversations:read", "team:manage"] },
    });
    expect(res.status).toBe(201);
    expect(res.json.key).toMatch(/^owa_live_/);
    expect(res.json.scopes).toEqual(["conversations:read"]); // non-delegable scope dropped
    const list = await call(apiKeysRoute.GET, { cookie });
    expect(JSON.stringify(list.json)).not.toContain(res.json.key as string);

    const rotated = await call(rotateRoute.POST, {
      method: "POST",
      cookie,
      params: { id: res.json.id as string },
      body: { graceDays: 0 },
    });
    expect(rotated.status).toBe(200);
    expect(rotated.json.key).not.toBe(res.json.key);
    expect((await call(conversationsRoute.GET, { bearer: res.json.key as string })).status).toBe(401);
    expect((await call(conversationsRoute.GET, { bearer: rotated.json.key as string })).status).toBe(200);
  });
});

describe("roles and CSRF", () => {
  it("enforces role permissions", async () => {
    const viewer = await createOrgWithUser("VIEWER");
    const cookie = await sessionCookie(viewer.user.id, viewer.org.id);
    expect((await call(conversationsRoute.GET, { cookie })).status).toBe(200);
    expect(
      (
        await call(providersRoute.POST, {
          method: "POST",
          cookie,
          body: { name: "x", kind: "MOCK", model: "m" },
        })
      ).status,
    ).toBe(403);
    expect((await call(apiKeysRoute.GET, { cookie })).status).toBe(403);
  });

  it("rejects cookie-authenticated mutations without the CSRF headers", async () => {
    const { user, org } = await createOrgWithUser("OWNER");
    const cookie = await sessionCookie(user.id, org.id);
    const body = { name: "x", scopes: ["conversations:read"] };
    expect((await call(apiKeysRoute.POST, { method: "POST", cookie, body, csrf: false })).status).toBe(403);
    expect(
      (
        await call(apiKeysRoute.POST, {
          method: "POST",
          cookie,
          body,
          csrf: false,
          headers: { origin: "https://evil.example", "x-openwa-csrf": "1" },
        })
      ).status,
    ).toBe(403);
    expect((await call(apiKeysRoute.POST, { method: "POST", cookie, body })).status).toBe(201);
  });

  it("login requires CSRF headers and does not reveal whether an account exists", async () => {
    const { user } = await createOrgWithUser("OWNER");
    const ok = await call(loginRoute.POST, {
      method: "POST",
      body: { email: user.email, password: TEST_PASSWORD },
      csrf: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const wrong = await call(loginRoute.POST, {
      method: "POST",
      body: { email: user.email, password: "Wrong-password-1" },
      csrf: true,
    });
    const unknown = await call(loginRoute.POST, {
      method: "POST",
      body: { email: "nobody@example.com", password: "Wrong-password-1" },
      csrf: true,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error).toEqual(unknown.json.error);
    // Without the CSRF header pair a login is refused (login CSRF).
    expect(
      (await call(loginRoute.POST, { method: "POST", body: { email: user.email, password: TEST_PASSWORD } }))
        .status,
    ).toBe(403);
  });

  it("locks an account after repeated failed logins", async () => {
    const { user } = await createOrgWithUser("OWNER");
    for (let i = 0; i < 8; i++)
      await call(loginRoute.POST, {
        method: "POST",
        body: { email: user.email, password: `Wrong-password-${i}` },
        csrf: true,
      });
    const locked = await call(loginRoute.POST, {
      method: "POST",
      body: { email: user.email, password: TEST_PASSWORD },
      csrf: true,
    });
    expect([401, 429]).toContain(locked.status);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit within a window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit("test:key", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("WhatsApp webhook endpoint", () => {
  async function cloudChannel() {
    const { ctx } = await createOrgWithUser("OWNER", { sandbox: false });
    const channel = await createChannel(ctx, {
      kind: "WHATSAPP_CLOUD",
      name: "WA",
      phoneNumberId: "1234567890",
      accessToken: "test-access-token-not-real-000000",
      appSecret: "test-app-secret-not-real",
      verifyToken: "test-verify-token-0000",
    });
    return { ctx, channel };
  }

  it("completes the verification handshake only with the right token", async () => {
    const { channel } = await cloudChannel();
    const ok = await call(webhookRoute.GET, {
      params: { channelId: channel.id },
      path: `/x?hub.mode=subscribe&hub.verify_token=test-verify-token-0000&hub.challenge=abc123`,
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toBe("abc123");
    const bad = await call(webhookRoute.GET, {
      params: { channelId: channel.id },
      path: `/x?hub.mode=subscribe&hub.verify_token=wrong-token-000000&hub.challenge=abc123`,
    });
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned or wrongly signed events and accepts valid ones idempotently", async () => {
    const { channel } = await cloudChannel();
    const { payload } = buildSimulatedInbound({
      phoneNumberId: "1234567890",
      from: "254700000002",
      name: "Amina",
      text: "Hello",
    });
    const raw = JSON.stringify(payload);
    const unsigned = await call(webhookRoute.POST, {
      method: "POST",
      params: { channelId: channel.id },
      rawBody: raw,
    });
    expect(unsigned.status).toBe(401);
    const forged = await call(webhookRoute.POST, {
      method: "POST",
      params: { channelId: channel.id },
      rawBody: raw,
      headers: { "x-hub-signature-256": `sha256=${hmacSha256Hex("wrong", raw)}` },
    });
    expect(forged.status).toBe(401);
    expect(await prisma.message.count()).toBe(0);

    const sig = `sha256=${hmacSha256Hex("test-app-secret-not-real", raw)}`;
    const first = await call(webhookRoute.POST, {
      method: "POST",
      params: { channelId: channel.id },
      rawBody: raw,
      headers: { "x-hub-signature-256": sig },
    });
    const again = await call(webhookRoute.POST, {
      method: "POST",
      params: { channelId: channel.id },
      rawBody: raw,
      headers: { "x-hub-signature-256": sig },
    });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(1);
    expect(await prisma.job.count({ where: { type: "process_inbound" } })).toBe(1);
  });
});

describe("OpenAPI endpoint", () => {
  it("serves a valid OpenAPI 3.1 document", async () => {
    const res = await call(openapiRoute.GET as never);
    expect(res.status).toBe(200);
    expect(String(res.json.openapi)).toMatch(/^3\.1/);
  });
});

describe("idempotency keys", () => {
  it("replays the first response for a repeated Idempotency-Key", async () => {
    const { org } = await createOrgWithUser("OWNER");
    const owner = await prisma.membership.findFirstOrThrow({ where: { orgId: org.id } });
    const { key } = await createApiKey(ctxFor(org.id, owner.userId, "OWNER"), {
      name: "w",
      scopes: ["tickets:write", "tickets:read"],
    });
    const body = { subject: "Router broken", description: "red light" };
    const r1 = await call(ticketsRoute.POST, {
      method: "POST",
      bearer: key,
      body,
      headers: { "idempotency-key": "abc-1" },
    });
    const r2 = await call(ticketsRoute.POST, {
      method: "POST",
      bearer: key,
      body,
      headers: { "idempotency-key": "abc-1" },
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect(r2.json.id).toBe(r1.json.id);
    expect(await prisma.ticket.count({ where: { orgId: org.id } })).toBe(1);
    const mismatch = await call(ticketsRoute.POST, {
      method: "POST",
      bearer: key,
      body: { subject: "Different" },
      headers: { "idempotency-key": "abc-1" },
    });
    expect(mismatch.status).toBe(422);
  });
});
