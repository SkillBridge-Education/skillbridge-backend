import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../middleware/authMiddleware";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { deleteStoredImage, storeImage, type ImageKind } from "../services/uploadService";

/**
 * Files are held in memory rather than written to a temp directory: nothing
 * untrusted should touch the disk before it has been validated and re-encoded.
 * The size limit is enforced here too, so an oversized body is cut off as it
 * arrives instead of being buffered in full first.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// Re-encoding an image costs real CPU, so this is as much about not letting one
// account monopolise the server as it is about abuse.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many uploads. Please try again later." });
  },
});

const router = Router();

const handleUpload = (kind: ImageKind) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new HttpError(400, "No image was uploaded");

      const userId = getAuthenticatedUserId(req);
      const { url } = await storeImage(req.file.buffer, kind);

      const field = kind === "avatar" ? "avatarUrl" : "bannerUrl";
      const previous = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { [field]: true } as { avatarUrl: true } | { bannerUrl: true },
      });

      const user = await prisma.user.update({
        where: { id: userId },
        data: { [field]: url },
        select: { id: true, avatarUrl: true, bannerUrl: true },
      });

      // Only after the new one is safely recorded, so a failed write never
      // leaves the account with no image at all.
      await deleteStoredImage((previous as Record<string, string | null>)[field]);

      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

router.post("/avatar", authenticate, uploadLimiter, upload.single("image"), handleUpload("avatar"));
router.post("/banner", authenticate, uploadLimiter, upload.single("image"), handleUpload("banner"));

/** Removing an image is not the same as uploading an empty one. */
const handleDelete = (kind: ImageKind) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getAuthenticatedUserId(req);
      const field = kind === "avatar" ? "avatarUrl" : "bannerUrl";

      const current = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarUrl: true, bannerUrl: true },
      });

      await prisma.user.update({ where: { id: userId }, data: { [field]: null } });
      await deleteStoredImage(current[field]);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

router.delete("/avatar", authenticate, handleDelete("avatar"));
router.delete("/banner", authenticate, handleDelete("banner"));

export default router;
