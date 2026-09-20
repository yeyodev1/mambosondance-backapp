import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as accessService from "../services/access.service";

/**
 * POST /api/admin/access — body: { email, productIds, expiresAt, note? }
 * `expiresAt` es obligatorio como clave: fecha ISO futura o `null` explícito.
 */
export async function grant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const expiresAt = accessService.parseExpiresAt(req.body);
    const { email, productIds, note } = req.body ?? {};
    const accesses = await accessService.grantManual({
      email: String(email ?? ""),
      productIds,
      expiresAt,
      note: note ? String(note) : "",
      grantedBy: req.user.userId,
    });
    res.status(201).json(accesses);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/access?product=&user=&status=&page= */
export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { product, user, status, page, limit } = req.query;
    const result = await accessService.listAccesses({
      product: product ? String(product) : undefined,
      user: user ? String(user) : undefined,
      status: status ? String(status) : undefined,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/access/:id — body: { expiresAt } (misma regla: fecha futura o null explícito). */
export async function patch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const expiresAt = accessService.parseExpiresAt(req.body);
    res.status(200).json(await accessService.patchAccess(String(req.params.id), expiresAt));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/access/:id/revoke */
export async function revoke(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await accessService.revokeAccess(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
