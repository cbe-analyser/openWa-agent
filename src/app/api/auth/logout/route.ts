import { NextResponse } from "next/server";
import { route, verifyCsrf } from "@/server/http/route";
import { destroySession, sessionCookieName } from "@/server/auth/sessions";

export const POST = route({ auth: "public" }, async (req) => {
  verifyCsrf(req);
  const token = req.cookies.get(sessionCookieName())?.value;
  if (token) await destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(sessionCookieName());
  return res;
});
