import { z } from "zod";

// The server, not the client, decides how much data can leave in one response.
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Cursor pagination query: ?limit=20&cursor=<id>
 *
 * Cursors are opaque record ids rather than offsets. Offsets skip or duplicate
 * rows whenever something is inserted between two page loads, which happens
 * constantly on feeds, messages and notifications.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  cursor: z.string().uuid().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Builds the Prisma arguments for a cursor page. Always fetches one extra row
 * so we can tell whether another page exists without a second count query.
 */
export const toPrismaPageArgs = ({ limit, cursor }: PaginationQuery) => ({
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

/**
 * Trims the extra row fetched by toPrismaPageArgs and derives the next cursor.
 */
export const toPage = <T extends { id: string }>(
  rows: T[],
  limit: number
): Page<T> => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
};
