import { afterAll, beforeEach } from "vitest";
import { prisma } from "@/server/db";
import { resetDb } from "./db";
import { setProviderFactory } from "@/server/ai/router";

beforeEach(async () => {
  setProviderFactory(null);
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});
