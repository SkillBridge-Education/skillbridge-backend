import { z } from "zod";
import { paginationQuerySchema } from "../utils/pagination";

// Free-text search terms are capped so a caller cannot push a megabyte-long
// string into a LIKE query.
const searchTerm = z.string().trim().min(1).max(100).optional();

export const searchQuerySchema = paginationQuerySchema.extend({
  q: searchTerm,
  skill: searchTerm,
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const userIdParamSchema = z.object({
  id: z.string().uuid("A valid user id is required"),
});
