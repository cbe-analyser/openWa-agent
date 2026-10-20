import type {
  AIProviderKind,
  AutonomyMode,
  ChannelKind,
  EmbeddingKind,
  Prisma,
  ToolPermission,
} from "@prisma/client";
import { prisma } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { requirePermission, type AuthContext } from "../auth/context";
import { generateApiKey, sanitizeScopes } from "../auth/apiKeys";
import { decryptSecret, encryptSecret, hint, randomToken, sha256Hex } from "../security/crypto";
import { assertPublicUrl } from "../security/ssrf";
import { checkProviderHealth } from "../ai/router";
import { adapterFor } from "../channels/registry";
import { customIntentSchema } from "../agent/intents";
import { httpToolConfigSchema } from "../tools/http";
import { builtinTool } from "../tools/builtin";
import { enqueue } from "../jobs/queue";
import { auditCtx } from "./audit";
import { WEBHOOK_EVENTS } from "./events";
import { setGlobalKillSwitch } from "./system";

// ---------------------------------------------------------------- Agent settings

export interface AgentSettingsInput {
  agentName?: string;
  businessDescription?: string;
  agentInstructions?: string;
  autonomyMode?: AutonomyMode;
  confidenceThreshold?: number;
  maxTroubleshootTurns?: number;
  autoReplyIntents?: string[];
  customIntents?: unknown;
  escalationMessage?: string;
  timezone?: string;
  optOutKeywords?: string[];
  optInKeywords?: string[];
  followUpTemplateName?: string | null;
  followUpTemplateLang?: string;
  retentionDays?: number | null;
  name?: string;
}

export async function getOrgSettings(ctx: AuthContext) {
  requirePermission(ctx, "settings:read");
  return prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
}

export async function updateOrgSettings(ctx: AuthContext, input: AgentSettingsInput) {
  requirePermission(ctx, "settings:write");
  if (input.customIntents !== undefined && !customIntentSchema.safeParse(input.customIntents).success)
    throw badRequest("Invalid custom intents");
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw badRequest("Unknown timezone");
    }
  }
  if (input.optOutKeywords && input.optOutKeywords.length === 0)
    throw badRequest("At least one opt-out keyword is required");
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const u = await prisma.organization.update({
    where: { id: ctx.orgId },
    data: input as Prisma.OrganizationUpdateInput,
  });
  const changed = Object.keys(input).filter(
    (k) =>
      JSON.stringify((before as Record<string, unknown>)[k]) !==
      JSON.stringify((input as Record<string, unknown>)[k]),
  );
  await auditCtx(
    ctx,
    "settings.updated",
    { type: "organization", id: ctx.orgId },
    { changed, autonomyMode: input.autonomyMode },
  );
  return u;
}

export async function setOrgAiPaused(ctx: AuthContext, paused: boolean) {
  requirePermission(ctx, "settings:write");
  await prisma.organization.update({ where: { id: ctx.orgId }, data: { aiPaused: paused } });
  await auditCtx(ctx, paused ? "ai.paused_org" : "ai.resumed_org", { type: "organization", id: ctx.orgId });
}

export async function setInstanceKillSwitch(ctx: AuthContext, on: boolean) {
  if (!ctx.isInstanceAdmin)
    throw forbidden("Only an instance administrator can change the global emergency switch");
  await setGlobalKillSwitch(on);
  await auditCtx(ctx, on ? "ai.global_kill_switch_on" : "ai.global_kill_switch_off");
}

// ---------------------------------------------------------------- AI providers

export interface ProviderInput {
  name: string;
  kind: AIProviderKind;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  maxOutputTokens?: number;
  temperature?: number | null;
  timeoutMs?: number;
  maxRetries?: number;
  contextTokenLimit?: number;
  monthlyTokenBudget?: number | null;
  inputCostPerMTok?: number | null;
  outputCostPerMTok?: number | null;
  settings?: Record<string, unknown>;
  isPrimary?: boolean;
  allowAsFallback?: boolean;
  fallbackPriority?: number;
  enabled?: boolean;
}

/** Never return stored secrets — only a short hint. */
export function presentProvider<T extends { encryptedApiKey: string | null }>(p: T) {
  const { encryptedApiKey, ...rest } = p;
  let keyHint: string | null = null;
  if (encryptedApiKey) {
    try {
      keyHint = hint(decryptSecret(encryptedApiKey));
    } catch {
      keyHint = "(unreadable — re-enter)";
    }
  }
  return { ...rest, hasApiKey: !!encryptedApiKey, apiKeyHint: keyHint };
}

export async function listProviders(ctx: AuthContext) {
  requirePermission(ctx, "settings:read");
  const rows = await prisma.aIProviderConfig.findMany({
    where: { orgId: ctx.orgId },
    orderBy: [{ isPrimary: "desc" }, { fallbackPriority: "asc" }],
  });
  return rows.map(presentProvider);
}

async function validateProviderInput(input: Partial<ProviderInput>) {
  if (input.baseUrl) {
    const u = new URL(input.baseUrl);
    if (!["http:", "https:"].includes(u.protocol)) throw badRequest("Base URL must be http(s)");
  }
  if (input.kind === "ANTHROPIC" && input.baseUrl) await assertPublicUrl(input.baseUrl);
}

export async function createProvider(ctx: AuthContext, input: ProviderInput) {
  requirePermission(ctx, "settings:write");
  await validateProviderInput(input);
  if (input.kind === "ANTHROPIC" && !input.apiKey) throw badRequest("An API key is required for Anthropic");
  const { apiKey, ...rest } = input;
  const p = await prisma.$transaction(async (tx) => {
    const hasPrimary = await tx.aIProviderConfig.count({ where: { orgId: ctx.orgId, isPrimary: true } });
    const makePrimary = input.isPrimary || hasPrimary === 0;
    if (makePrimary)
      await tx.aIProviderConfig.updateMany({ where: { orgId: ctx.orgId }, data: { isPrimary: false } });
    return tx.aIProviderConfig.create({
      data: {
        ...rest,
        settings: (input.settings ?? {}) as Prisma.InputJsonValue,
        orgId: ctx.orgId,
        isPrimary: makePrimary,
        encryptedApiKey: apiKey ? encryptSecret(apiKey) : null,
      },
    });
  });
  await auditCtx(
    ctx,
    "ai_provider.created",
    { type: "ai_provider", id: p.id },
    { kind: p.kind, model: p.model },
  );
  return presentProvider(p);
}

export async function updateProvider(ctx: AuthContext, id: string, input: Partial<ProviderInput>) {
  requirePermission(ctx, "settings:write");
  const existing = await prisma.aIProviderConfig.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!existing) throw notFound("AI provider");
  await validateProviderInput({ ...input, kind: input.kind ?? existing.kind });
  const { apiKey, settings, ...rest } = input;
  const p = await prisma.$transaction(async (tx) => {
    if (input.isPrimary)
      await tx.aIProviderConfig.updateMany({
        where: { orgId: ctx.orgId, id: { not: id } },
        data: { isPrimary: false },
      });
    return tx.aIProviderConfig.update({
      where: { id },
      data: {
        ...rest,
        ...(settings ? { settings: settings as Prisma.InputJsonValue } : {}),
        // undefined = keep, "" or null = clear, value = replace
        ...(apiKey === undefined ? {} : { encryptedApiKey: apiKey ? encryptSecret(apiKey) : null }),
      },
    });
  });
  await auditCtx(
    ctx,
    "ai_provider.updated",
    { type: "ai_provider", id },
    { fields: Object.keys(input).map((k) => (k === "apiKey" ? "apiKey(rotated)" : k)) },
  );
  return presentProvider(p);
}

export async function deleteProvider(ctx: AuthContext, id: string) {
  requirePermission(ctx, "settings:write");
  const res = await prisma.aIProviderConfig.deleteMany({ where: { id, orgId: ctx.orgId } });
  if (!res.count) throw notFound("AI provider");
  await auditCtx(ctx, "ai_provider.deleted", { type: "ai_provider", id });
}

export async function testProvider(ctx: AuthContext, id: string) {
  requirePermission(ctx, "settings:read");
  const p = await prisma.aIProviderConfig.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!p) throw notFound("AI provider");
  return checkProviderHealth(p);
}

// ---------------------------------------------------------------- Embeddings

export async function getEmbeddingConfig(ctx: AuthContext) {
  requirePermission(ctx, "settings:read");
  const c = await prisma.embeddingConfig.upsert({
    where: { orgId: ctx.orgId },
    create: { orgId: ctx.orgId },
    update: {},
  });
  return presentProvider(c);
}

export async function updateEmbeddingConfig(
  ctx: AuthContext,
  input: {
    kind: EmbeddingKind;
    model?: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    dimensions?: number;
    minRelevance?: number;
  },
) {
  requirePermission(ctx, "settings:write");
  const { apiKey, ...rest } = input;
  const model = input.kind === "LOCAL_HASH" ? `local-hash-${input.dimensions ?? 384}` : input.model;
  if (!model) throw badRequest("Model is required");
  const before = await prisma.embeddingConfig.findUnique({ where: { orgId: ctx.orgId } });
  const c = await prisma.embeddingConfig.upsert({
    where: { orgId: ctx.orgId },
    create: { orgId: ctx.orgId, ...rest, model, encryptedApiKey: apiKey ? encryptSecret(apiKey) : null },
    update: {
      ...rest,
      model,
      ...(apiKey === undefined ? {} : { encryptedApiKey: apiKey ? encryptSecret(apiKey) : null }),
    },
  });
  if (!before || before.model !== c.model || before.kind !== c.kind) {
    // Embeddings from different models are not comparable: re-index every document.
    const docs = await prisma.knowledgeDocument.findMany({
      where: { orgId: ctx.orgId },
      select: { id: true },
    });
    for (const d of docs)
      await enqueue(
        "index_document",
        { documentId: d.id },
        { orgId: ctx.orgId, dedupeKey: `index:${d.id}:model:${c.model}:${Date.now()}` },
      );
  }
  await auditCtx(
    ctx,
    "embedding.updated",
    { type: "embedding_config", id: c.id },
    { kind: c.kind, model: c.model },
  );
  return presentProvider(c);
}

// ---------------------------------------------------------------- Channels

export interface ChannelInput {
  kind: ChannelKind;
  name: string;
  phoneNumberId?: string;
  wabaId?: string;
  displayPhoneNumber?: string;
  apiVersion?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
}

export function presentChannel<
  T extends {
    encryptedAccessToken: string | null;
    encryptedAppSecret: string | null;
    verifyTokenHash: string | null;
  },
>(c: T) {
  const { encryptedAccessToken, encryptedAppSecret, verifyTokenHash, ...rest } = c;
  return {
    ...rest,
    hasAccessToken: !!encryptedAccessToken,
    hasAppSecret: !!encryptedAppSecret,
    hasVerifyToken: !!verifyTokenHash,
  };
}

export async function listChannels(ctx: AuthContext) {
  requirePermission(ctx, "settings:read");
  return (await prisma.channel.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "asc" } })).map(
    presentChannel,
  );
}

export async function createChannel(ctx: AuthContext, input: ChannelInput) {
  requirePermission(ctx, "settings:write");
  if (input.kind === "WHATSAPP_CLOUD") {
    if (!input.phoneNumberId || !input.accessToken || !input.appSecret || !input.verifyToken) {
      throw badRequest("Phone number ID, access token, app secret and verify token are required");
    }
    if (input.verifyToken.length < 16) throw badRequest("Verify token must be at least 16 characters");
  }
  const c = await prisma.channel.create({
    data: {
      orgId: ctx.orgId,
      kind: input.kind,
      name: input.name,
      status: input.kind === "SIMULATOR" ? "ACTIVE" : "PENDING",
      phoneNumberId: input.kind === "SIMULATOR" ? `sim-${randomToken(8)}` : input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: input.displayPhoneNumber,
      apiVersion: input.apiVersion ?? "v21.0",
      encryptedAccessToken: input.accessToken ? encryptSecret(input.accessToken) : null,
      encryptedAppSecret: input.appSecret ? encryptSecret(input.appSecret) : null,
      verifyTokenHash: input.verifyToken ? sha256Hex(input.verifyToken) : null,
    },
  });
  await auditCtx(ctx, "channel.created", { type: "channel", id: c.id }, { kind: c.kind });
  return presentChannel(c);
}

export async function updateChannel(
  ctx: AuthContext,
  id: string,
  input: Partial<ChannelInput> & { status?: "ACTIVE" | "DISABLED" },
) {
  requirePermission(ctx, "settings:write");
  const c = await prisma.channel.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound("Channel");
  if (input.verifyToken !== undefined && input.verifyToken.length < 16)
    throw badRequest("Verify token must be at least 16 characters");
  const u = await prisma.channel.update({
    where: { id },
    data: {
      name: input.name,
      status: input.status,
      wabaId: input.wabaId,
      displayPhoneNumber: input.displayPhoneNumber,
      apiVersion: input.apiVersion,
      ...(c.kind === "WHATSAPP_CLOUD" && input.phoneNumberId ? { phoneNumberId: input.phoneNumberId } : {}),
      ...(input.accessToken ? { encryptedAccessToken: encryptSecret(input.accessToken) } : {}),
      ...(input.appSecret ? { encryptedAppSecret: encryptSecret(input.appSecret) } : {}),
      ...(input.verifyToken ? { verifyTokenHash: sha256Hex(input.verifyToken) } : {}),
    },
  });
  await auditCtx(
    ctx,
    "channel.updated",
    { type: "channel", id },
    { fields: Object.keys(input).map((k) => (/token|secret/i.test(k) ? `${k}(rotated)` : k)) },
  );
  return presentChannel(u);
}

export async function deleteChannel(ctx: AuthContext, id: string) {
  requirePermission(ctx, "settings:write");
  const res = await prisma.channel.deleteMany({ where: { id, orgId: ctx.orgId } });
  if (!res.count) throw notFound("Channel");
  await auditCtx(ctx, "channel.deleted", { type: "channel", id });
}

export async function channelHealth(ctx: AuthContext, id: string) {
  requirePermission(ctx, "settings:read");
  const c = await prisma.channel.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound("Channel");
  const h = await adapterFor(c.kind).healthCheck(c);
  await prisma.channel.update({
    where: { id },
    data: {
      status: c.status === "DISABLED" ? "DISABLED" : h.ok ? "ACTIVE" : "ERROR",
      lastError: h.ok ? null : h.detail.slice(0, 500),
    },
  });
  return h;
}

export async function channelTemplates(ctx: AuthContext, id: string) {
  requirePermission(ctx, "settings:read");
  const c = await prisma.channel.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound("Channel");
  const adapter = adapterFor(c.kind);
  if (!adapter.listTemplates) return [];
  return adapter.listTemplates(c);
}

export async function createChannelTemplate(
  ctx: AuthContext,
  id: string,
  t: { name: string; language: string; category: string; body: string },
) {
  requirePermission(ctx, "settings:write");
  const c = await prisma.channel.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound("Channel");
  const adapter = adapterFor(c.kind);
  if (!adapter.createTemplate) throw badRequest("This channel does not support template management");
  const res = await adapter.createTemplate(c, t);
  await auditCtx(
    ctx,
    "channel.template_submitted",
    { type: "channel", id },
    { name: t.name, category: t.category },
  );
  return res;
}

// ---------------------------------------------------------------- Tools

export async function listTools(ctx: AuthContext) {
  requirePermission(ctx, "integrations:read");
  const rows = await prisma.toolConfig.findMany({
    where: { orgId: ctx.orgId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return rows.map(({ encryptedSecret, ...r }) => ({ ...r, hasSecret: !!encryptedSecret }));
}

export interface HttpToolInput {
  name: string;
  description: string;
  permission: ToolPermission;
  requiresApproval?: boolean;
  timeoutMs?: number;
  enabled?: boolean;
  config?: unknown;
  secret?: string | null;
}

export async function upsertHttpTool(ctx: AuthContext, input: HttpToolInput, id?: string) {
  requirePermission(ctx, "integrations:write");
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(input.name))
    throw badRequest("Tool name must be lowercase letters, digits and underscores (3–41 chars)");
  if (builtinTool(input.name)) throw badRequest("That name is reserved for a built-in tool");
  const cfg = httpToolConfigSchema.parse(input.config);
  await assertPublicUrl(cfg.urlTemplate.replace(/\{[a-z0-9_]+\}/g, "x"));
  const data = {
    name: input.name,
    description: input.description,
    permission: input.permission,
    requiresApproval: input.requiresApproval ?? input.permission === "HIGH_IMPACT",
    timeoutMs: Math.min(Math.max(input.timeoutMs ?? 10_000, 1000), 30_000),
    enabled: input.enabled ?? true,
    config: cfg as unknown as Prisma.InputJsonValue,
    ...(input.secret === undefined
      ? {}
      : { encryptedSecret: input.secret ? encryptSecret(input.secret) : null }),
  };
  let t;
  if (id) {
    const existing = await prisma.toolConfig.findFirst({ where: { id, orgId: ctx.orgId, kind: "HTTP" } });
    if (!existing) throw notFound("Tool");
    t = await prisma.toolConfig.update({ where: { id }, data });
  } else {
    t = await prisma.toolConfig.create({ data: { ...data, orgId: ctx.orgId, kind: "HTTP" } });
  }
  await auditCtx(
    ctx,
    id ? "tool.updated" : "tool.created",
    { type: "tool", id: t.id },
    { name: t.name, permission: t.permission },
  );
  const { encryptedSecret, ...rest } = t;
  return { ...rest, hasSecret: !!encryptedSecret };
}

export async function setToolEnabled(
  ctx: AuthContext,
  id: string,
  input: { enabled?: boolean; requiresApproval?: boolean },
) {
  requirePermission(ctx, "integrations:write");
  const t = await prisma.toolConfig.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw notFound("Tool");
  const u = await prisma.toolConfig.update({ where: { id }, data: input });
  await auditCtx(ctx, "tool.updated", { type: "tool", id }, input);
  return u;
}

export async function deleteTool(ctx: AuthContext, id: string) {
  requirePermission(ctx, "integrations:write");
  const res = await prisma.toolConfig.deleteMany({ where: { id, orgId: ctx.orgId, kind: "HTTP" } });
  if (!res.count) throw notFound("Tool");
  await auditCtx(ctx, "tool.deleted", { type: "tool", id });
}

// ---------------------------------------------------------------- API keys

export async function listApiKeys(ctx: AuthContext) {
  requirePermission(ctx, "apikeys:manage");
  return prisma.apiKey.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      rotatedFromId: true,
    },
  });
}

/** Creates an API key. The full secret is returned exactly once and stored only as a hash. */
export async function createApiKey(
  ctx: AuthContext,
  input: { name: string; scopes: string[]; expiresInDays?: number | null },
  rotatedFromId?: string,
) {
  requirePermission(ctx, "apikeys:manage");
  if (ctx.kind !== "session") throw forbidden("API keys can only be managed from the dashboard");
  const scopes = sanitizeScopes(input.scopes);
  if (scopes.length === 0) throw badRequest("Select at least one valid scope");
  const { key, prefix, hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      prefix,
      keyHash: hash,
      scopes,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
      createdById: ctx.userId,
      rotatedFromId: rotatedFromId ?? null,
    },
  });
  await auditCtx(
    ctx,
    rotatedFromId ? "api_key.rotated" : "api_key.created",
    { type: "api_key", id: row.id },
    { scopes, prefix },
  );
  return { id: row.id, name: row.name, prefix, scopes, expiresAt: row.expiresAt, key };
}

export async function revokeApiKey(ctx: AuthContext, id: string) {
  requirePermission(ctx, "apikeys:manage");
  const res = await prisma.apiKey.updateMany({
    where: { id, orgId: ctx.orgId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!res.count) throw notFound("Active API key");
  await auditCtx(ctx, "api_key.revoked", { type: "api_key", id });
}

/** Rotation: issues a new key with the same scopes and revokes the old one. */
export async function rotateApiKey(ctx: AuthContext, id: string, graceDays = 0) {
  requirePermission(ctx, "apikeys:manage");
  const old = await prisma.apiKey.findFirst({ where: { id, orgId: ctx.orgId, revokedAt: null } });
  if (!old) throw notFound("Active API key");
  const created = await createApiKey(
    ctx,
    {
      name: old.name,
      scopes: old.scopes,
      expiresInDays: old.expiresAt
        ? Math.max(1, Math.ceil((old.expiresAt.getTime() - Date.now()) / 86400_000))
        : null,
    },
    old.id,
  );
  if (graceDays > 0)
    await prisma.apiKey.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() + graceDays * 86400_000) },
    });
  else await prisma.apiKey.update({ where: { id: old.id }, data: { revokedAt: new Date() } });
  return created;
}

// ---------------------------------------------------------------- Outbound webhooks

export async function listWebhookEndpoints(ctx: AuthContext) {
  requirePermission(ctx, "integrations:read");
  return prisma.webhookEndpoint.findMany({
    where: { orgId: ctx.orgId },
    select: {
      id: true,
      url: true,
      description: true,
      events: true,
      enabled: true,
      lastDeliveryAt: true,
      failureCount: true,
      createdAt: true,
    },
  });
}

export async function createWebhookEndpoint(
  ctx: AuthContext,
  input: { url: string; events: string[]; description?: string },
) {
  requirePermission(ctx, "integrations:write");
  const url = await assertPublicUrl(input.url);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production")
    throw badRequest("Webhook endpoints must use HTTPS");
  const events = input.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw badRequest("Select at least one event");
  const secret = `whsec_${randomToken(24)}`;
  const ep = await prisma.webhookEndpoint.create({
    data: {
      orgId: ctx.orgId,
      url: url.toString(),
      events,
      description: input.description ?? "",
      encryptedSecret: encryptSecret(secret),
    },
  });
  await auditCtx(ctx, "webhook.created", { type: "webhook_endpoint", id: ep.id }, { events });
  return { id: ep.id, url: ep.url, events: ep.events, secret };
}

export async function updateWebhookEndpoint(
  ctx: AuthContext,
  id: string,
  input: { enabled?: boolean; events?: string[] },
) {
  requirePermission(ctx, "integrations:write");
  const ep = await prisma.webhookEndpoint.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!ep) throw notFound("Webhook endpoint");
  const events = input.events?.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  await prisma.webhookEndpoint.update({
    where: { id },
    data: { enabled: input.enabled, ...(events ? { events } : {}) },
  });
  await auditCtx(ctx, "webhook.updated", { type: "webhook_endpoint", id }, input);
}

export async function deleteWebhookEndpoint(ctx: AuthContext, id: string) {
  requirePermission(ctx, "integrations:write");
  const res = await prisma.webhookEndpoint.deleteMany({ where: { id, orgId: ctx.orgId } });
  if (!res.count) throw notFound("Webhook endpoint");
  await auditCtx(ctx, "webhook.deleted", { type: "webhook_endpoint", id });
}
