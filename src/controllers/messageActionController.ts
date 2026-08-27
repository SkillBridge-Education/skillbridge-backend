import { NextFunction, Request, Response } from "express";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  deleteMessage,
  editMessage,
  listPinnedMessages,
  setMessagePin,
} from "../services/messageActionService";

/**
 * Acting on one message inside a conversation.
 *
 * Thin on purpose: every rule about who may edit what, and for how long, lives
 * in the service, so the socket broadcast and the HTTP answer cannot drift apart.
 */

// PATCH /conversations/:id/messages/:messageId
export const editMessageController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const message = await editMessage(
      req.params.id as string,
      req.params.messageId as string,
      getAuthenticatedUserId(req),
      req.body.body as string
    );
    res.status(200).json({ message });
  } catch (error) {
    next(error);
  }
};

// DELETE /conversations/:id/messages/:messageId?scope=me|everyone
export const deleteMessageController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { scope } = req.query as unknown as { scope: "me" | "everyone" };
    const message = await deleteMessage(
      req.params.id as string,
      req.params.messageId as string,
      getAuthenticatedUserId(req),
      scope
    );
    res.status(200).json({ message });
  } catch (error) {
    next(error);
  }
};

// POST /conversations/:id/messages/:messageId/pin
export const pinMessageController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const message = await setMessagePin(
      req.params.id as string,
      req.params.messageId as string,
      getAuthenticatedUserId(req),
      true
    );
    res.status(200).json({ message });
  } catch (error) {
    next(error);
  }
};

// DELETE /conversations/:id/messages/:messageId/pin
export const unpinMessageController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const message = await setMessagePin(
      req.params.id as string,
      req.params.messageId as string,
      getAuthenticatedUserId(req),
      false
    );
    res.status(200).json({ message });
  } catch (error) {
    next(error);
  }
};

// GET /conversations/:id/messages/pinned
export const listPinnedController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const messages = await listPinnedMessages(
      req.params.id as string,
      getAuthenticatedUserId(req)
    );
    res.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
};
