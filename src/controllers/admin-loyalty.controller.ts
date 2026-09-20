import { Request, Response, NextFunction } from "express";
import * as loyaltyService from "../services/loyalty.service";

/** POST /api/admin/loyalty/stamp — body: { email, note?, count?, source?: "attendance"|"manual" } */
export async function stamp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, note, count, source } = req.body ?? {};
    res.status(200).json(await loyaltyService.stampByEmail({ email, note, count, source }));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/loyalty/redeem — body: { email, note? }. 409 si no hay premios. */
export async function redeem(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, note } = req.body ?? {};
    res.status(200).json(await loyaltyService.redeemByEmail({ email, note }));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/loyalty/stamp/:stampId?email= */
export async function removeStamp(req: Request, res: Response, next: NextFunction) {
  try {
    const card = await loyaltyService.removeStampByEmail(
      req.query.email,
      String(req.params.stampId),
    );
    res.status(200).json(card);
  } catch (error) {
    next(error);
  }
}
