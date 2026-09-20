import { Request, Response, NextFunction } from "express";
import * as eventService from "../services/event.service";

/** GET /api/events?category=&when=upcoming|past&featured=&page=&limit= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await eventService.listPublic(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/events/:slug */
export async function getBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await eventService.getPublicBySlug(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}
