import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { HttpError } from "../utils/httpError";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

/**
 * Image uploads for avatars and banners.
 *
 * Everything here rests on one decision: uploaded bytes are never stored. Each
 * image is decoded and *re-encoded* by sharp, and only the output is written to
 * disk. That single step does most of the security work — it strips EXIF (which
 * carries GPS coordinates, a real problem when the users are minors), and it
 * destroys anything hidden alongside the image data, since a polyglot file does
 * not survive being decoded to pixels and encoded again.
 *
 * It is not an antivirus. It is, however, the defence that actually matters for
 * images, and it needs no external service.
 */

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Magic bytes, because Content-Type is supplied by the client and a file
 * extension is just part of a string. Only formats sharp can safely re-encode.
 */
const SIGNATURES: Array<{ format: string; test: (buffer: Buffer) => boolean }> = [
  { format: "jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    format: "png",
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    format: "webp",
    test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export type ImageKind = "avatar" | "banner";

// Bounded so one upload cannot become a multi-megabyte download for everyone
// who views the profile.
const DIMENSIONS: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1600, height: 400 },
};

const detectFormat = (buffer: Buffer): string => {
  const match = SIGNATURES.find((signature) => signature.test(buffer));
  if (!match) {
    throw new HttpError(400, "Only JPEG, PNG and WebP images are accepted");
  }
  return match.format;
};

export const uploadDirectory = (): string =>
  path.resolve(env.uploadDir || path.join(process.cwd(), "uploads"));

/**
 * Validates, re-encodes and stores an image. Returns the public path the client
 * should save on the profile.
 */
export const storeImage = async (
  buffer: Buffer,
  kind: ImageKind
): Promise<{ url: string; filename: string }> => {
  if (buffer.length === 0) throw new HttpError(400, "The uploaded file is empty");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, "Images must be 5 MB or smaller");
  }

  detectFormat(buffer);

  const { width, height } = DIMENSIONS[kind];

  let output: Buffer;
  try {
    output = await sharp(buffer, { failOn: "error" })
      .rotate() // Applies the EXIF orientation before the metadata is dropped.
      .resize(width, height, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    // A file that passed the signature check but cannot be decoded is either
    // corrupt or crafted; either way it is not an image we will serve.
    logger.warn({ err: error, kind }, "Rejected an undecodable image upload");
    throw new HttpError(400, "This image could not be processed");
  }

  const filename = `${kind}-${randomUUID()}.webp`;
  const directory = path.join(uploadDirectory(), `${kind}s`);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), output);

  return { url: `/uploads/${kind}s/${filename}`, filename };
};

/**
 * Removes a previously stored image. Silent when the file is already gone —
 * replacing an avatar should not fail because the old one vanished.
 */
export const deleteStoredImage = async (publicUrl: string | null | undefined): Promise<void> => {
  if (!publicUrl?.startsWith("/uploads/")) return;

  // Resolve, then confirm the result is still inside the upload directory:
  // without this, a stored value containing ../ could reach anywhere on disk.
  const relative = publicUrl.replace(/^\/uploads\//, "");
  const target = path.resolve(uploadDirectory(), relative);

  if (!target.startsWith(uploadDirectory() + path.sep)) {
    logger.warn({ publicUrl }, "Refused to delete a path outside the upload directory");
    return;
  }

  try {
    await unlink(target);
  } catch {
    // Already absent; nothing to do.
  }
};
