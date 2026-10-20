import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

/** A tiny local HTTP server that stands in for AI or WhatsApp APIs in tests (no real credentials or network). */
export async function fakeServer(
  handler: (req: Recorded) => { status?: number; body: unknown; headers?: Record<string, string> },
) {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let body: unknown = data;
      try {
        body = data ? JSON.parse(data) : null;
      } catch {
        /* keep raw */
      }
      const rec = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body };
      requests.push(rec);
      const out = handler(rec);
      res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.headers ?? {}) });
      res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
