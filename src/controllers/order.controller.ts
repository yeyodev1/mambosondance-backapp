import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as orderService from "../services/order.service";

/**
 * POST /api/orders — body: { items, buyer, shipping? }
 * Sesión opcional: sin ella la orden se asocia al correo de `buyer`.
 */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await orderService.createOrder(req.user?.userId, req.body ?? {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/orders/confirm — body: { id, clientTransactionId }. Idempotente.
 * Sesión opcional: `clientTransactionId` hace de credencial de quien compró.
 */
export async function confirm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id, clientTransactionId } = req.body ?? {};
    const result = await orderService.confirmOrder(req.user, { id, clientTransactionId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/find — body: { email, number? }. Responde lo mismo exista o no el correo. */
export async function find(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { email, number } = req.body ?? {};
    await orderService.findPurchase({ email, number });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/mine */
export async function mine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await orderService.listMine(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/:id — dueño o admin. */
export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await orderService.getOrder(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
}
