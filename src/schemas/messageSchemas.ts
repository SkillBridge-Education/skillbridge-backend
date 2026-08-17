import { z } from "zod";
import { env } from "../utils/env";

// Schemes that execute or embed content rather than pointing at a file. A
// `javascript:` URL stored here and later rendered as a link is stored XSS.
const BLOCKED_SCHEMES = ["javascript:", "data:", "vbscript:", "file:", "blob:"];

/**
 * Attachments are supplied by the client as a URL — the API does not host files
 * itself. Until it does, the URL is the entire trust boundary, so it is
 * validated strictly rather than trimmed and stored.
 *
 * Note this cannot verify what the URL actually serves. Real safety needs
 * server-side upload, MIME sniffing and malware scanning; this only closes the
 * injection hole.
 */
export const fileUrlSchema = z
  .string()
  .trim()
  .min(1, "File URL cannot be empty")
  .max(2048, "File URL is too long")
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (BLOCKED_SCHEMES.includes(url.protocol)) return false;

    // https only: an http attachment can be swapped in transit.
    if (url.protocol !== "https:") return false;

    // When a storage host is configured, attachments must come from it, so a
    // user cannot pass off an arbitrary third-party link as an upload.
    const allowed = env.allowedFileHosts;
    if (allowed.length > 0 && !allowed.includes(url.hostname)) return false;

    return true;
  }, "File URL must be a valid https link from an approved host");

export const sendFileMessageSchema = z.object({
  fileUrl: fileUrlSchema,
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000),
});

export const conversationIdParamSchema = z.object({
  id: z.string().uuid("A valid conversation id is required"),
});
