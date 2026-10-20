import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../env";

const ALGO = "aes-256-gcm";

function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** Encrypts a secret for storage. Format: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const key = decodeKey(env().ENCRYPTION_KEY);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    keyId(key),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, kid, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== "v1" || !kid || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("Unrecognised encrypted secret format");
  }
  const candidates = [env().ENCRYPTION_KEY, env().ENCRYPTION_KEY_PREVIOUS].filter(Boolean) as string[];
  for (const b64 of candidates) {
    const key = decodeKey(b64);
    if (keyId(key) !== kid) continue;
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString(
      "utf8",
    );
  }
  throw new Error("No configured encryption key can decrypt this secret");
}

/** True when the secret was encrypted with a key other than the current ENCRYPTION_KEY. */
export function needsReencryption(payload: string): boolean {
  const kid = payload.split(".")[1];
  return kid !== keyId(decodeKey(env().ENCRYPTION_KEY));
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string | Buffer, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Shows only the last 4 characters of a secret, e.g. for settings screens. */
export function hint(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return `••••${secret.slice(-4)}`;
}
