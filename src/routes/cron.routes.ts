import { Router, Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import { dbConnect, isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import * as accessService from "../services/access.service";

const router = Router();

/**
 * Solo Vercel Cron puede disparar esto.
 *
 * Vercel manda `Authorization: Bearer $CRON_SECRET` en cada corrida. Sin el
 * secreto configurado la ruta queda cerrada: es preferible que la tarea no
 * ocurra a que cualquiera desde internet pueda dispararla.
 */
function soloCron(req: Request, _res: Response, next: NextFunction) {
  if (!env.CRON_SECRET) {
    return next(new CustomError("CRON_SECRET no está configurado", 503));
  }
  if (req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
    return next(new CustomError("No autorizado", 401));
  }
  next();
}

/**
 * GET /api/cron/access-reminders — diario (ver `crons` en vercel.json).
 * Avisa por correo 7 días antes y el día del vencimiento de cada acceso.
 * Vercel Cron solo hace GET, de ahí el verbo aunque la tarea escriba.
 */
router.get("/access-reminders", soloCron, async (_req, res, next) => {
  try {
    if (!isConnected() && !(await dbConnect())) {
      throw new CustomError("Sin base de datos", 503);
    }
    const result = await accessService.sendExpiryReminders();
    console.log("[cron] access-reminders", result);
    res.status(200).json({ ok: true, at: new Date().toISOString(), ...result });
  } catch (error) {
    next(error);
  }
});

export default router;
