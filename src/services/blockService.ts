import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";

/**
 * Enforcement for user blocks.
 *
 * The block table was being written and listed, and read by nothing — so
 * "Bloquer" recorded a row and changed no behaviour at all. Blocked accounts
 * could still send connection requests, open the blocker's profile and appear in
 * their search results. On a platform used by minors that is the difference
 * between a safety feature and a decoration.
 *
 * Blocks are enforced *symmetrically*. If A blocks B, then B cannot reach A —
 * which is the point — but A also stops seeing B. Someone who blocks an account
 * has said they want it out of their experience, not that they want a one-way
 * mirror onto it.
 */

/** True when either person has blocked the other. */
export const areBlocked = async (userId: string, otherId: string): Promise<boolean> => {
  if (userId === otherId) return false;

  const found = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: otherId },
        { blockerId: otherId, blockedId: userId },
      ],
    },
    select: { id: true },
  });

  return found !== null;
};

/**
 * Refuses an interaction between two people when either has blocked the other.
 *
 * The message deliberately does not say who blocked whom. Telling B that A
 * blocked them turns the feature into a notification, which is the thing that
 * makes people hesitate to use it.
 */
export const assertNotBlocked = async (userId: string, otherId: string): Promise<void> => {
  if (await areBlocked(userId, otherId)) {
    throw new HttpError(403, "Cette interaction n'est pas possible");
  }
};

/**
 * Every account that must disappear from this user's lists, in both directions.
 *
 * Returned as an array for use in `notIn` filters. Callers that page over large
 * result sets should treat this as a filter of last resort — it is fine at the
 * scale of a person's own block list, which is what it is for.
 */
export const blockedIdsFor = async (userId: string): Promise<string[]> => {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
  }

  return [...ids];
};

/**
 * A `where` fragment excluding everyone this user has blocked or been blocked by.
 *
 * Returns `{}` when there is nothing to exclude, so it can be spread into any
 * query without adding a pointless `notIn: []`.
 */
export const excludeBlockedFilter = async (
  userId: string | undefined,
  field: "id" | "userId" = "id"
): Promise<Prisma.UserWhereInput> => {
  if (!userId) return {};

  const blocked = await blockedIdsFor(userId);
  if (blocked.length === 0) return {};

  return { [field]: { notIn: blocked } } as Prisma.UserWhereInput;
};
