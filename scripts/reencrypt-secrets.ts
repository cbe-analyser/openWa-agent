/**
 * Re-encrypts every stored secret with the current ENCRYPTION_KEY after a key rotation.
 *
 *   1. Set ENCRYPTION_KEY_PREVIOUS to the old key and ENCRYPTION_KEY to the new one.
 *   2. Restart the app and worker (both keys can decrypt during the transition).
 *   3. Run: npm run secrets:reencrypt
 *   4. Remove ENCRYPTION_KEY_PREVIOUS and restart again.
 *
 * Prints counts only — never secret values.
 */
import { prisma } from "../src/server/db";
import { decryptSecret, encryptSecret, needsReencryption } from "../src/server/security/crypto";

type Row = { id: string; value: string | null };

async function rotate(label: string, rows: Row[], save: (id: string, v: string) => Promise<unknown>) {
  let done = 0;
  for (const r of rows) {
    if (!r.value || !needsReencryption(r.value)) continue;
    await save(r.id, encryptSecret(decryptSecret(r.value)));
    done++;
  }
  console.log(`${label}: re-encrypted ${done} of ${rows.filter((r) => r.value).length}`);
}

async function main() {
  await rotate(
    "AI provider keys",
    (await prisma.aIProviderConfig.findMany({ select: { id: true, encryptedApiKey: true } })).map((r) => ({
      id: r.id,
      value: r.encryptedApiKey,
    })),
    (id, v) => prisma.aIProviderConfig.update({ where: { id }, data: { encryptedApiKey: v } }),
  );
  await rotate(
    "Embedding keys",
    (await prisma.embeddingConfig.findMany({ select: { id: true, encryptedApiKey: true } })).map((r) => ({
      id: r.id,
      value: r.encryptedApiKey,
    })),
    (id, v) => prisma.embeddingConfig.update({ where: { id }, data: { encryptedApiKey: v } }),
  );
  const channels = await prisma.channel.findMany({
    select: { id: true, encryptedAccessToken: true, encryptedAppSecret: true },
  });
  await rotate(
    "Channel access tokens",
    channels.map((c) => ({ id: c.id, value: c.encryptedAccessToken })),
    (id, v) => prisma.channel.update({ where: { id }, data: { encryptedAccessToken: v } }),
  );
  await rotate(
    "Channel app secrets",
    channels.map((c) => ({ id: c.id, value: c.encryptedAppSecret })),
    (id, v) => prisma.channel.update({ where: { id }, data: { encryptedAppSecret: v } }),
  );
  await rotate(
    "Tool secrets",
    (await prisma.toolConfig.findMany({ select: { id: true, encryptedSecret: true } })).map((r) => ({
      id: r.id,
      value: r.encryptedSecret,
    })),
    (id, v) => prisma.toolConfig.update({ where: { id }, data: { encryptedSecret: v } }),
  );
  await rotate(
    "Webhook signing secrets",
    (await prisma.webhookEndpoint.findMany({ select: { id: true, encryptedSecret: true } })).map((r) => ({
      id: r.id,
      value: r.encryptedSecret,
    })),
    (id, v) => prisma.webhookEndpoint.update({ where: { id }, data: { encryptedSecret: v } }),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
