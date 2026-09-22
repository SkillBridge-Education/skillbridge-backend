import { randomUUID } from "crypto";
import { prisma } from "../utils/prisma";

// Every test user gets this prefix so cleanup can find and remove them by email
// without touching real/dev data that may already exist in the database.
export const TEST_EMAIL_PREFIX = "vitest-";

export const uniqueTestEmail = (): string =>
  `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`;

export const cleanupTestUsers = async (): Promise<void> => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
};
