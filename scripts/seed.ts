/**
 * Seeds a demo organization for local development and evaluation.
 *
 *   npm run db:seed
 *
 * Creates (idempotently): an owner account, a demo organization with the mock AI provider and a
 * simulator channel, and a small fictional knowledge base. The password comes from
 * SEED_ADMIN_PASSWORD, or a random one is generated and printed once. Refuses to run when
 * NODE_ENV=production unless --force is passed. All demo content is fictional.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/server/db";
import { env } from "../src/server/env";
import { hashPassword, validatePasswordStrength } from "../src/server/security/passwords";
import { sha256Hex } from "../src/server/security/crypto";
import { createOrganization } from "../src/server/services/orgs";
import { indexDocument } from "../src/server/knowledge/ingest";

const DEMO_DOCS: Array<{ title: string; category: string; sourceType: string; text: string }> = [
  {
    title: "Acme Fibre — opening hours and contacts",
    category: "general",
    sourceType: "TEXT",
    text: `Acme Fibre is a fictional home internet provider used for demonstrations.
Customer support hours: Monday to Friday 8:00–18:00 and Saturday 9:00–13:00 (East Africa Time). We are closed on Sundays and public holidays.
Our walk-in shop is at 12 Example Road, Nairobi. Field technicians visit between 9:00 and 17:00.`,
  },
  {
    title: "Router troubleshooting guide",
    category: "troubleshooting",
    sourceType: "TEXT",
    text: `If the internet is not working:
1. Check that the router power light is on. If it is off, check the power cable and the wall socket.
2. Look at the LOS light. A red LOS light means the fibre signal is lost; this needs a technician and cannot be fixed by restarting.
3. If LOS is off and the internet light is off, restart the router: switch it off, wait 30 seconds, switch it on and wait 3 minutes.
4. If Wi-Fi is slow, move closer to the router and check how many devices are connected. The 5 GHz network is faster but has shorter range.
5. If the problem continues after a restart, we open a support ticket and a technician contacts you within one business day.`,
  },
  {
    title: "Plans and billing FAQ",
    category: "billing",
    sourceType: "FAQ",
    text: `Q: What plans do you offer?
A: Home 20 Mbps costs KES 2,999 per month, Home 50 Mbps costs KES 4,499 per month and Home 100 Mbps costs KES 6,999 per month. Installation is free.

Q: When is my bill due?
A: Bills are issued on the 1st of every month and are due on the 10th. Service is suspended if the bill is unpaid on the 15th.

Q: How do I pay?
A: Pay by M-Pesa Paybill 000000 (demo number) using your account number, or by bank transfer. Never share your M-Pesa PIN with anyone, including our staff.

Q: Can I get a refund?
A: Refunds are reviewed by our billing team. The assistant will hand your request to a person.`,
  },
];

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error("Refusing to seed demo data with NODE_ENV=production. Pass --force if you really mean it.");
    process.exit(1);
  }
  env(); // validates configuration early
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  let password = process.env.SEED_ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = `Demo-${randomBytes(9).toString("base64url")}`;
    generated = true;
  }
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(`SEED_ADMIN_PASSWORD: ${weak}`);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const firstUser = (await prisma.user.count()) === 0;
    user = await prisma.user.create({
      data: {
        email,
        name: "Demo Admin",
        passwordHash: await hashPassword(password),
        isInstanceAdmin: firstUser,
      },
    });
    console.log(`Created user ${email}${generated ? ` with password: ${password}` : ""}`);
    if (generated) console.log("This password is shown only once. Change it after signing in.");
  } else {
    console.log(`User ${email} already exists; password unchanged.`);
  }

  let org = await prisma.organization.findFirst({
    where: { memberships: { some: { userId: user.id } }, name: "Acme Fibre (demo)" },
  });
  if (!org) {
    org = await prisma.$transaction((tx) => createOrganization(tx, "Acme Fibre (demo)", { sandbox: true }));
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: "OWNER" } });
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        agentName: "Acme Assistant",
        businessDescription:
          "Acme Fibre is a fictional home fibre internet provider in Nairobi, Kenya, used for demonstrations.",
        timezone: "Africa/Nairobi",
        autonomyMode: "SUPERVISED",
      },
    });
    console.log(`Created organization "${org.name}" with a simulator channel and the mock AI provider.`);
  }

  for (const d of DEMO_DOCS) {
    const exists = await prisma.knowledgeDocument.findFirst({ where: { orgId: org.id, title: d.title } });
    if (exists) continue;
    const doc = await prisma.knowledgeDocument.create({
      data: {
        orgId: org.id,
        title: d.title,
        category: d.category,
        sourceType: d.sourceType,
        text: d.text,
        contentHash: sha256Hex(d.text),
        createdById: user.id,
      },
    });
    await indexDocument(org.id, doc.id);
    console.log(`Indexed "${d.title}"`);
  }
  console.log(
    `Done. Start the app (npm run dev) and the worker (npm run worker), then sign in at ${env().APP_URL}/login`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
