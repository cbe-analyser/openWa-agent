import type { Role } from "@prisma/client";
import type { Permission } from "./permissions";
import { forbidden } from "../errors";

export interface AuthContext {
  kind: "session" | "apiKey";
  orgId: string;
  userId: string | null;
  role: Role | null;
  permissions: Permission[];
  isInstanceAdmin: boolean;
  sessionId?: string;
  apiKeyId?: string;
  ip: string | null;
  requestId: string;
}

export function can(ctx: AuthContext, permission: Permission): boolean {
  return ctx.permissions.includes(permission);
}

export function requirePermission(ctx: AuthContext, permission: Permission): void {
  if (!can(ctx, permission)) throw forbidden(`Missing permission: ${permission}`);
}

/** Actor description for audit logs. */
export function actorOf(ctx: AuthContext): { actorType: string; actorId: string | null } {
  return ctx.kind === "apiKey"
    ? { actorType: "API_KEY", actorId: ctx.apiKeyId ?? null }
    : { actorType: "USER", actorId: ctx.userId };
}
