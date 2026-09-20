import { Request, Response, NextFunction } from "express";
import * as promoService from "../services/promo.service";

/** GET /api/admin/promos?q=&page= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await promoService.adminList(req.query));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/promos */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await promoService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/promos/:id — solo cambia las claves enviadas. */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await promoService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/promos/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await promoService.remove(String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
