import { Request, Response, NextFunction } from "express";
import * as eventService from "../services/event.service";

/** GET /api/admin/events?category=&when=&q=&page= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await eventService.adminList(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/events/:id */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await eventService.adminGet(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/events */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await eventService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/events/:id — las tarifas con `id` conservan su contador de vendidas. */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await eventService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/events/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await eventService.remove(String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
