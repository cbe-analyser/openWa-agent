import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { AppError, badRequest, forbidden, tooManyRequests, unauthorized } from "../errors";
import { logger } from "../logger";
import { resolveApiKey } from "../auth/apiKeys";
import { requirePermission, type AuthContext } from "../auth/context";
import type { Permission } from "../auth/permissions";
import { resolveSession, sessionCookieName } from "../auth/sessions";
import { rateLimit } from "../security/ratelimit";
import { sha256Hex } from "../security/crypto";
import { clientIp, requestIdFrom } from "./request";

type AuthMode = "public" | "session" | "any";

export interface RouteOptions {
  /** public: no auth; session: dashboard users only; any: session or API key. */
  auth: AuthMode;
  permission?: Permission;
  rateLimit?: { limit: number; windowSec: number };
  /** Honour the Idempotency-Key header (POST/PUT/PATCH). */
  idempotent?: boolean;
}

export interface HandlerArgs<P> {
  ctx: AuthContext;
  params: P;
  requestId: string;
  ip: string | null;
}

export interface PublicHandlerArgs<P> {
  ctx: AuthContext | null;
  params: P;
  requestId: string;
  ip: string | null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function authenticate(req: NextRequest, ip: string | null, requestId: string, mode: AuthMode) {
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer ") && mode === "any") {
    return resolveApiKey(authz.slice(7).trim(), ip, requestId);
  }
  const token = req.cookies.get(sessionCookieName())?.value;
  if (!token) return null;
  const ctx = await resolveSession(token, ip, requestId);
  if (ctx && !SAFE_METHODS.has(req.method)) verifyCsrf(req);
  return ctx;
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the browser must send a
 * same-origin Origin header and the custom X-OpenWa-CSRF header (which cross-site forms cannot set).
 */
export function verifyCsrf(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = new URL(env().APP_URL).origin;
  let sameHost = false;
  try {
    sameHost = !!origin && new URL(origin).host === req.headers.get("host");
  } catch {
    sameHost = false;
  }
  if (!origin || (origin !== allowed && !sameHost)) throw forbidden("Cross-origin request rejected");
  if (req.headers.get("x-openwa-csrf") !== "1") throw forbidden("Missing CSRF header");
}

export function errorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof AppError) {
    const res = NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details }, requestId },
      { status: err.status },
    );
    if (
      err.status === 429 &&
      err.details &&
      typeof err.details === "object" &&
      "retryAfterSec" in err.details
    ) {
      res.headers.set("Retry-After", String((err.details as { retryAfterSec: number }).retryAfterSec));
    }
    return res;
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Request validation failed",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        requestId,
      },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return NextResponse.json(
        { error: { code: "not_found", message: "Resource not found" }, requestId },
        { status: 404 },
      );
    }
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: { code: "conflict", message: "Resource already exists" }, requestId },
        { status: 409 },
      );
    }
  }
  logger.error({ err, requestId }, "Unhandled API error");
  return NextResponse.json(
    { error: { code: "internal_error", message: "An unexpected error occurred" }, requestId },
    { status: 500 },
  );
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result);
}

type RouteContext = { params: Promise<Record<string, string | string[]>> };

export function route<P = Record<string, string>>(
  opts: RouteOptions & { auth: "public" },
  handler: (req: NextRequest, args: PublicHandlerArgs<P>) => Promise<unknown>,
): (req: NextRequest, rc: RouteContext) => Promise<Response>;
export function route<P = Record<string, string>>(
  opts: RouteOptions,
  handler: (req: NextRequest, args: HandlerArgs<P>) => Promise<unknown>,
): (req: NextRequest, rc: RouteContext) => Promise<Response>;
export function route<P>(
  opts: RouteOptions,
  handler: (req: NextRequest, args: HandlerArgs<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, rc: RouteContext): Promise<Response> => {
    const requestId = requestIdFrom(req.headers);
    const ip = clientIp(req.headers);
    try {
      const params = ((await rc?.params) ?? {}) as P;
      let ctx: AuthContext | null = null;
      if (opts.auth !== "public") {
        ctx = await authenticate(req, ip, requestId, opts.auth);
        if (!ctx) throw unauthorized();
        if (opts.permission) requirePermission(ctx, opts.permission);
      }
      if (opts.rateLimit) {
        const who = ctx ? (ctx.apiKeyId ?? ctx.userId ?? "anon") : (ip ?? "unknown");
        const rl = await rateLimit(
          `${req.method}:${req.nextUrl.pathname}:${who}`,
          opts.rateLimit.limit,
          opts.rateLimit.windowSec,
        );
        if (!rl.allowed) throw tooManyRequests(rl.retryAfterSec);
      }

      const idemKey = req.headers.get("idempotency-key");
      if (opts.idempotent && idemKey && ctx && !SAFE_METHODS.has(req.method)) {
        if (idemKey.length > 200) throw badRequest("Idempotency-Key too long");
        const bodyText = await req.clone().text();
        const scope = `${ctx.orgId}:${req.method}:${req.nextUrl.pathname}`;
        const requestHash = sha256Hex(bodyText);
        const existing = await prisma.idempotencyKey.findUnique({
          where: { scope_key: { scope, key: idemKey } },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new AppError(
              422,
              "idempotency_mismatch",
              "Idempotency-Key was reused with a different request body",
            );
          }
          const replay = NextResponse.json(existing.responseBody, { status: existing.responseStatus });
          replay.headers.set("Idempotent-Replayed", "true");
          replay.headers.set("x-request-id", requestId);
          return replay;
        }
        const res = toResponse(await handler(req, { ctx, params, requestId, ip }));
        if (res.status < 300) {
          const body = await res
            .clone()
            .json()
            .catch(() => null);
          await prisma.idempotencyKey
            .create({
              data: {
                scope,
                key: idemKey,
                requestHash,
                responseStatus: res.status,
                responseBody: body ?? {},
              },
            })
            .catch(() => undefined);
        }
        res.headers.set("x-request-id", requestId);
        return res;
      }

      const res = toResponse(await handler(req, { ctx: ctx as AuthContext, params, requestId, ip }));
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      const res = errorResponse(err, requestId);
      res.headers.set("x-request-id", requestId);
      return res;
    }
  };
}

/** Parses and validates a JSON body. */
export async function parseJson<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 1_000_000) throw badRequest("Request body too large");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}
