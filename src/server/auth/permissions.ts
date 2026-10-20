import type { Role } from "@prisma/client";

export const PERMISSIONS = [
  "conversations:read",
  "conversations:write",
  "messages:send",
  "customers:read",
  "customers:write",
  "tickets:read",
  "tickets:write",
  "followups:read",
  "followups:write",
  "knowledge:read",
  "knowledge:write",
  "integrations:read",
  "integrations:write",
  "settings:read",
  "settings:write",
  "team:manage",
  "apikeys:manage",
  "audit:read",
  "usage:read",
  "health:read",
  "workflows:trigger",
  "data:export",
  "data:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Scopes that may be granted to API keys. Account/security administration is session-only. */
export const API_KEY_SCOPES: Permission[] = [
  "conversations:read",
  "conversations:write",
  "messages:send",
  "customers:read",
  "tickets:read",
  "tickets:write",
  "followups:read",
  "followups:write",
  "knowledge:read",
  "knowledge:write",
  "integrations:read",
  "integrations:write",
  "usage:read",
  "health:read",
  "workflows:trigger",
];

const AGENT: Permission[] = [
  "conversations:read",
  "conversations:write",
  "messages:send",
  "customers:read",
  "customers:write",
  "tickets:read",
  "tickets:write",
  "followups:read",
  "followups:write",
  "knowledge:read",
  "integrations:read",
  "settings:read",
  "usage:read",
  "health:read",
];

const VIEWER: Permission[] = [
  "conversations:read",
  "customers:read",
  "tickets:read",
  "followups:read",
  "knowledge:read",
  "integrations:read",
  "settings:read",
  "usage:read",
  "health:read",
];

const ADMIN: Permission[] = PERMISSIONS.filter((p) => p !== "data:delete");

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN,
  AGENT,
  VIEWER,
};

export const ROLE_RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, AGENT: 2, VIEWER: 1 };

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
