import { Request, Response, NextFunction } from "express";
import * as settingsService from "../services/settings.service";

/** GET /api/settings/public — lo que la web necesita sin sesión. */
export async function getPublic(_req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.getSettings();
    res.status(200).json(settingsService.toPublicSettings(settings));
  } catch (error) {
    next(error);
  }
}
