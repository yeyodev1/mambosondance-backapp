import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as meService from "../services/me.service";

/**
 * GET /api/lessons/:id/playback — la sesión es opcional (optionalAuth): las
 * lecciones de muestra se ven sin cuenta; el resto exige acceso vigente.
 */
export async function playback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await meService.getPlayback(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
}

/** POST /api/lessons/:id/complete — body: { completed: boolean } */
export async function complete(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const completed = req.body?.completed;
    if (typeof completed !== "boolean") {
      throw new CustomError("Indica si la clase quedó completada", 400);
    }
    await meService.setLessonCompleted(req.user, String(req.params.id), completed);
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
