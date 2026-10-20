import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backoffMs } from "@/server/jobs/queue";
import { chunkText } from "@/server/knowledge/chunk";
import { assertContentMatches, extensionOf, htmlToText } from "@/server/knowledge/extract";
import { LocalHashEmbedding } from "@/server/knowledge/embeddings";
import { buildOpenApi, OPENAPI_PATHS } from "@/server/openapi";
import { jsonSchemaToZod } from "@/server/tools/jsonSchemaToZod";
import { signWebhook } from "@/server/services/events";
import { hmacSha256Hex } from "@/server/security/crypto";
import { extractJsonObject } from "@/server/ai/json";

describe("job backoff", () => {
  it("grows exponentially and is capped at one hour", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(5000);
    expect(backoffMs(1)).toBeLessThan(6000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(20000);
    expect(backoffMs(30)).toBeLessThan(60 * 60 * 1000 + 1000);
  });
});

describe("chunking", () => {
  it("splits long text into overlapping chunks below the target size", () => {
    const text = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i} explains step ${i} of resetting the router in detail.`,
    ).join("\n\n");
    const chunks = chunkText(text, 400, 80);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(520);
    expect(chunks.join(" ")).toContain("Paragraph 59");
  });
  it("returns nothing for empty text", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
  });
});

describe("file extraction guards", () => {
  it("accepts only supported extensions", () => {
    expect(extensionOf("Guide.PDF")).toBe("pdf");
    expect(() => extensionOf("malware.exe")).toThrow();
  });
  it("rejects files whose content does not match the extension", () => {
    expect(() => assertContentMatches("pdf", Buffer.from("not a pdf"))).toThrow();
    expect(() => assertContentMatches("docx", Buffer.from("plain"))).toThrow();
    expect(() => assertContentMatches("pdf", Buffer.from("%PDF-1.7\n..."))).not.toThrow();
  });
  it("strips scripts and tags from HTML", () => {
    const r = htmlToText(
      "<html><head><title>FAQ</title><script>alert(1)</script></head><body><h1>Hours</h1><p>Open 8–6</p></body></html>",
    );
    expect(r.title).toBe("FAQ");
    expect(r.text).toContain("Open 8–6");
    expect(r.text).not.toContain("alert");
  });
});

describe("local embeddings", () => {
  it("are deterministic, normalized and similar for related text", async () => {
    const e = new LocalHashEmbedding(384);
    const [a, b, c] = await e.embed([
      "router red light",
      "red light on my router",
      "monthly invoice payment",
    ]);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(a!.length).toBe(384);
    expect(Math.abs(dot(a!, a!) - 1)).toBeLessThan(1e-6);
    expect(dot(a!, b!)).toBeGreaterThan(dot(a!, c!));
  });
});

describe("HTTP tool input schemas", () => {
  it("validates inputs with the configured JSON schema subset", () => {
    const z = jsonSchemaToZod({
      type: "object",
      properties: { order_id: { type: "string", maxLength: 10 }, qty: { type: "integer", minimum: 1 } },
      required: ["order_id"],
    });
    expect(z.safeParse({ order_id: "A123" }).success).toBe(true);
    expect(z.safeParse({ order_id: "A123", qty: 0 }).success).toBe(false);
    expect(z.safeParse({ qty: 1 }).success).toBe(false);
    expect(z.safeParse({ order_id: "A123", extra: "x" }).success).toBe(false);
  });
});

describe("outbound webhook signatures", () => {
  it("signs t.body with HMAC-SHA256", () => {
    const sig = signWebhook("whsec_test", '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${hmacSha256Hex("whsec_test", '1700000000.{"a":1}')}`);
  });
});

describe("model JSON extraction", () => {
  it("finds a JSON object inside prose or code fences", () => {
    expect(extractJsonObject('Sure!\n```json\n{"reply":"hi","confidence":0.9}\n```')).toEqual({
      reply: "hi",
      confidence: 0.9,
    });
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("OpenAPI document", () => {
  const apiRoot = path.resolve(__dirname, "../../src/app/api/v1");
  const toFile = (p: string) => path.join(apiRoot, p.replace(/\{([^}]+)\}/g, "[$1]"), "route.ts");

  it("every documented path has a route handler exporting the documented methods", () => {
    const doc = buildOpenApi("http://localhost:3000") as { paths: Record<string, Record<string, unknown>> };
    for (const p of OPENAPI_PATHS) {
      const file = toFile(p);
      expect(fs.existsSync(file), `${p} → ${file}`).toBe(true);
      const src = fs.readFileSync(file, "utf8");
      const docPath = Object.keys(doc.paths).find((k) => k.endsWith(p))!;
      for (const method of Object.keys(doc.paths[docPath]!))
        expect(src, `${method.toUpperCase()} ${p}`).toMatch(
          new RegExp(`export const ${method.toUpperCase()}\\b`),
        );
    }
  });

  it("every API-key-accessible route is documented", () => {
    const missing: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "route.ts" && fs.readFileSync(full, "utf8").includes('auth: "any"')) {
          const rel =
            "/" +
            path
              .relative(apiRoot, path.dirname(full))
              .split(path.sep)
              .join("/")
              .replace(/\[([^\]]+)\]/g, "{$1}");
          if (!OPENAPI_PATHS.includes(rel)) missing.push(rel);
        }
      }
    };
    walk(apiRoot);
    expect(missing).toEqual([]);
  });
});
