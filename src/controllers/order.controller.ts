import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as orderService from "../services/order.service";

/** POST /api/orders — body: { items, buyer, shipping? } */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const result = await orderService.createOrder(req.user.userId, req.body ?? {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/confirm — body: { id, clientTransactionId }. Idempotente. */
export async function confirm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { id, clientTransactionId } = req.body ?? {};
    const result = await orderService.confirmOrder(req.user, { id, clientTransactionId });
    res.status(200).json(result);
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
