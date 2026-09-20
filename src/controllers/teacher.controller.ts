import { Request, Response, NextFunction } from "express";
import * as teacherService from "../services/teacher.service";

/** GET /api/teachers — publicados, en el orden que definió la academia. */
export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await teacherService.listPublic());
  } catch (error) {
    next(error);
  }
}
