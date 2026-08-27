import { z } from "zod";
import { env } from "../utils/env";

// Schemes that execute or embed content rather than pointing at a file. A
// `javascript:` URL stored here and later rendered as a link is stored XSS.
const BLOCKED_SCHEMES = ["javascript:", "data:", "vbscript:", "file:", "blob:"];

/**
 * Paths served by this API's own upload endpoint.
 *
 * These are the *safest* attachments there are: the file was sniffed for its
 * magic bytes and re-encoded through sharp on the way in, so it is known to be
 * an image and carries no EXIF. Rejecting them — which this schema did, because
 * it predates the upload endpoint and only accepted absolute https — meant every
 * single attachment upload succeeded and then failed to send.
 *
 * The pattern is deliberately narrow: one of our three known directories, a
 * plain filename, no traversal, no scheme, no host.
 */
const OWN_UPLOAD_PATH = /^\/uploads\/(avatar|banner|chat)s\/[A-Za-z0-9._-]+$/;

/**
 * Attachments are either hosted by this API or supplied as an absolute URL.
 *
 * For the second kind the URL is the entire trust boundary, so it is validated
 * strictly rather than trimmed and stored. Note this cannot verify what a remote
 * URL actually serves — real safety needs upload, MIME sniffing and malware
 * scanning, which is exactly why the first kind is preferred.
 */
export const fileUrlSchema = z
  .string()
  .trim()
  .min(1, "File URL cannot be empty")
  .max(2048, "File URL is too long")
  .refine((value) => {
    // Our own storage, already validated and re-encoded on upload.
    if (value.startsWith("/uploads/")) return OWN_UPLOAD_PATH.test(value);

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
  }, "File URL must be an upload from this server or a valid https link from an approved host");

/**
 * The message this one answers, when it answers one.
 *
 * Optional, and only ever an id: the quoted text is read from the database at
 * send time rather than taken from the client, so a reply cannot be made to
 * display words the original author never wrote.
 */
const replyToIdSchema = z
  .string()
  .uuid("A valid message id is required")
  .optional();

export const sendFileMessageSchema = z.object({
  fileUrl: fileUrlSchema,
  fileName: z.string().trim().min(1).max(255).optional(),
  replyToId: replyToIdSchema,
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000),
  replyToId: replyToIdSchema,
});

export const conversationIdParamSchema = z.object({
  id: z.string().uuid("A valid conversation id is required"),
});

export const messageParamsSchema = z.object({
  id: z.string().uuid("A valid conversation id is required"),
  messageId: z.string().uuid("A valid message id is required"),
});

export const editMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000),
});

/**
 * "me" hides the message for the caller alone; "everyone" withdraws it for both.
 * Defaulting to the narrower of the two means a malformed request cannot delete
 * something out of the other participant's thread.
 */
export const deleteMessageQuerySchema = z.object({
  scope: z.enum(["me", "everyone"]).default("me"),
});
