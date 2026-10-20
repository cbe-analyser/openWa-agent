import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hint,
  hmacSha256Hex,
  needsReencryption,
  safeEqual,
} from "@/server/security/crypto";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/security/passwords";
import { maskPhone, redact, redactString } from "@/server/security/redact";
import { isPrivateAddress, assertPublicUrl } from "@/server/security/ssrf";
import { generateApiKey, sanitizeScopes } from "@/server/auth/apiKeys";
import { ROLE_PERMISSIONS, roleHas } from "@/server/auth/permissions";
import { resetEnvCache } from "@/server/env";
import { randomBytes } from "node:crypto";

describe("secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("sk-test-value-123");
    expect(enc).not.toContain("sk-test");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc)).toBe("sk-test-value-123");
  });
  it("detects tampering", () => {
    const enc = encryptSecret("value");
    const parts = enc.split(".");
    parts[4] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("supports key rotation with ENCRYPTION_KEY_PREVIOUS", () => {
    const original = process.env.ENCRYPTION_KEY!;
    const enc = encryptSecret("rotate-me");
    process.env.ENCRYPTION_KEY_PREVIOUS = original;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    resetEnvCache();
    try {
      expect(decryptSecret(enc)).toBe("rotate-me");
      expect(needsReencryption(enc)).toBe(true);
      expect(needsReencryption(encryptSecret("x"))).toBe(false);
    } finally {
      process.env.ENCRYPTION_KEY = original;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      resetEnvCache();
    }
  });
  it("hints never reveal the whole secret", () => {
    expect(hint("sk-ant-abcdefghijklmnop")).not.toContain("abcdefghij");
  });
  it("compares in constant time helpers", () => {
    expect(safeEqual(hmacSha256Hex("k", "a"), hmacSha256Hex("k", "a"))).toBe(true);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});

describe("passwords", () => {
  it("enforces strength and verifies scrypt hashes", async () => {
    expect(validatePasswordStrength("short")).not.toBeNull();
    expect(validatePasswordStrength("alllowercaseletters")).not.toBeNull();
    expect(validatePasswordStrength("Correct-Horse-42!")).toBeNull();
    const h = await hashPassword("Correct-Horse-42!");
    expect(await verifyPassword("Correct-Horse-42!", h)).toBe(true);
    expect(await verifyPassword("wrong-Password-1", h)).toBe(false);
  });
});

describe("log redaction", () => {
  it("removes keys, tokens and card numbers", () => {
    const out = redactString(
      "Authorization: Bearer abc.def.ghi key=sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKE card 4111 1111 1111 1111",
    );
    expect(out).not.toContain("sk-ant-api03-FAKE");
    expect(out).not.toContain("abc.def.ghi");
    expect(out).not.toContain("4111 1111 1111 1111");
  });
  it("redacts sensitive object keys deeply", () => {
    const out = redact({
      apiKey: "secret",
      nested: { accessToken: "t", password: "p", ok: "visible" },
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/"secret"|"t"|"p"/);
    expect(JSON.stringify(out)).toContain("visible");
  });
  it("masks phone numbers", () => {
    expect(maskPhone("254712345678")).not.toContain("12345");
  });
});

describe("SSRF guard", () => {
  it("classifies private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.3.4",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "0.0.0.0",
      "100.64.0.1",
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1"]) expect(isPrivateAddress(ip)).toBe(false);
  });
  it("rejects private and non-http URLs", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/admin")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://user:pass@example.com/")).rejects.toThrow();
  });
});

describe("API keys and roles", () => {
  it("generates prefixed keys whose hash is not the key", () => {
    const k = generateApiKey();
    expect(k.prefix.startsWith("owa_live_")).toBe(true);
    expect(k.key.startsWith(k.prefix)).toBe(true);
    expect(k.hash).not.toContain(k.key);
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("drops scopes that API keys may not hold", () => {
    expect(sanitizeScopes(["conversations:read", "team:manage", "apikeys:manage", "bogus"])).toEqual([
      "conversations:read",
    ]);
  });
  it("gives each role the expected powers", () => {
    expect(roleHas("VIEWER", "messages:send")).toBe(false);
    expect(roleHas("AGENT", "messages:send")).toBe(true);
    expect(roleHas("AGENT", "settings:write")).toBe(false);
    expect(roleHas("ADMIN", "data:delete")).toBe(false);
    expect(ROLE_PERMISSIONS.OWNER).toContain("data:delete");
  });
});
