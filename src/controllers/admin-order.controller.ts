import { Request, Response, NextFunction } from "express";
import * as orderService from "../services/order.service";

/** GET /api/admin/orders?status=&fulfillment=&q=&page= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, fulfillment, q, page, limit } = req.query;
    const result = await orderService.listOrders({
      status: status ? String(status) : undefined,
      fulfillment: fulfillment ? String(fulfillment) : undefined,
      q: q ? String(q) : undefined,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/orders/:id */
export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.getOrderAdmin(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/orders/:id — body: { fulfillment } */
export async function updateFulfillment(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderService.updateFulfillment(
      String(req.params.id),
      req.body?.fulfillment,
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}
