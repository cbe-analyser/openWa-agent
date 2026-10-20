import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, sessionCookieName } from "./sessions";
import { clientIp, requestIdFrom } from "../http/request";
import type { AuthContext } from "./context";

/** Resolves the signed-in user for a server-rendered page, or redirects to /login. */
export async function requirePageAuth(): Promise<AuthContext> {
  const ctx = await getPageAuth();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function getPageAuth(): Promise<AuthContext | null> {
  const c = await cookies();
  const h = await headers();
  const token = c.get(sessionCookieName())?.value;
  if (!token) return null;
  return resolveSession(token, clientIp(h), requestIdFrom(h));
}
