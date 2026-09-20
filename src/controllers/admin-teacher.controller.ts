import { Request, Response, NextFunction } from "express";
import * as teacherService from "../services/teacher.service";

/** GET /api/admin/teachers?q=&page= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await teacherService.adminList(req.query));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/teachers */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await teacherService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/teachers/:id — solo cambia las claves enviadas. */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await teacherService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/teachers/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await teacherService.remove(String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
