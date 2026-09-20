import { Request, Response, NextFunction } from "express";
import * as adminUserService from "../services/admin-user.service";

/** GET /api/admin/users?q=&page= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, page, limit } = req.query;
    const result = await adminUserService.listUsers({
      q: q ? String(q) : undefined,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/users/:id — { user, accesses, orders, loyalty } */
export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await adminUserService.getUserDetail(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
