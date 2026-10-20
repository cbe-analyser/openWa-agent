import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("sign in, chat as a customer, get a grounded AI reply, take over and answer as a human", async ({
  page,
}, testInfo) => {
  // A unique customer number per run and project keeps runs independent.
  const from = `2547${String(Date.now()).slice(-7)}${testInfo.project.name === "mobile" ? 2 : 1}`;

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  // Chat as a simulated customer through the same webhook pipeline as real WhatsApp traffic.
  await page.goto("/simulator");
  await page.getByLabel("Customer WhatsApp number").fill(from);
  await page.getByLabel("Message as customer").fill("What are your support hours on Saturday?");
  await page.getByRole("button", { name: "Send" }).click();
  // The background worker processes the message with the offline mock provider and the seeded knowledge base.
  await expect(page.getByText(/Saturday 9:00–13:00/)).toBeVisible({ timeout: 30_000 });

  // Open the conversation in the inbox and take over.
  await page.getByRole("link", { name: "Open in inbox" }).click();
  await expect(page.getByText("AI-controlled")).toBeVisible();
  await page.getByRole("button", { name: "Take over" }).click();
  await expect(page.getByText("Human-controlled")).toBeVisible();

  // Reply as a human.
  await page
    .getByLabel("Message", { exact: true })
    .fill("Hi, this is Wanjiku from the support team. Anything else I can help with?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("this is Wanjiku from the support team")).toBeVisible();

  // The audit trail records the takeover.
  await expect(page.getByText(/conversation\.takeover/)).toBeVisible();
});

test("unauthenticated API calls are rejected and security headers are set", async ({ request }) => {
  const res = await request.get("/api/v1/conversations");
  expect(res.status()).toBe(401);
  const page = await request.get("/login");
  const headers = page.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
});
