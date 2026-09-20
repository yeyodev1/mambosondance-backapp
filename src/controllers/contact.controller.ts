import { Request, Response, NextFunction } from "express";
import * as contactService from "../services/contact.service";

/** POST /api/contact — body: { name, email, phone?, message } */
export async function send(req: Request, res: Response, next: NextFunction) {
  try {
    await contactService.sendContactMessage(req.body ?? {});
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
