import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as loyaltyService from "../services/loyalty.service";
import * as meService from "../services/me.service";

/** GET /api/me/courses */
export async function courses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await meService.myCourses(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/me/courses/:slug */
export async function course(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await meService.myCourse(req.user, String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/me/tickets */
export async function tickets(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await meService.myTickets(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/me/loyalty */
export async function loyalty(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await loyaltyService.getCard(req.user.userId));
  } catch (error) {
    next(error);
  }
}
