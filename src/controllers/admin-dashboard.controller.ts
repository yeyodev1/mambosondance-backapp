import { Request, Response, NextFunction } from "express";
import * as dashboardService from "../services/dashboard.service";

/** GET /api/admin/dashboard */
export async function summary(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await dashboardService.getDashboard());
  } catch (error) {
    next(error);
  }
}
