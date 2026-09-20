import { Request, Response, NextFunction } from "express";
import * as promoService from "../services/promo.service";

/** GET /api/promos — activas y dentro de fecha. */
export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await promoService.listPublic());
  } catch (error) {
    next(error);
  }
}
