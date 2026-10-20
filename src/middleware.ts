import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/signup", "/invite"];

function cspHeader(nonce: string, dev: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Adds security headers and a per-request CSP nonce, assigns request IDs, and redirects
 * unauthenticated page requests to /login. (Authorization itself is enforced server-side.)
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const isApi = pathname.startsWith("/api/");
  const hasSession = req.cookies.has("owa_session") || req.cookies.has("__Host-owa_session");

  if (!isApi && !hasSession && !PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = cspHeader(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);
  if (!isApi) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("cross-origin-opener-policy", "same-origin");
  if (req.nextUrl.protocol === "https:")
    res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (isApi) {
    res.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    res.headers.set("cache-control", "no-store");
  } else {
    res.headers.set("content-security-policy", csp);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
