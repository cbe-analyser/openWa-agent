import { expect, test } from "@playwright/test";

const PAGES: Array<[string, string]> = [
  ["/", "Overview"],
  ["/inbox", "Inbox"],
  ["/customers", "Customers"],
  ["/tickets", "Support tickets"],
  ["/followups", "Follow-ups"],
  ["/simulator", "Simulator"],
  ["/agent", "AI agent"],
  ["/knowledge", "Knowledge base"],
  ["/tools", "Tools & integrations"],
  ["/connections", "WhatsApp connections"],
  ["/team", "Team"],
  ["/analytics", "Analytics"],
  ["/usage", "Usage & costs"],
  ["/audit", "Audit log"],
  ["/health", "System health"],
  ["/developer", "Developer API"],
  ["/security", "Security & privacy"],
  ["/setup", "Setup & docs"],
];

test("every dashboard page renders real data without errors or horizontal overflow", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  for (const [path, heading] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 15_000 });
    // Ignore Next.js's empty route announcer; any visible error message fails the test.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`${path === "/" ? "overview" : path.slice(1)}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
