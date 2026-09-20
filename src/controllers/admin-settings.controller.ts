import { Request, Response, NextFunction } from "express";
import * as settingsService from "../services/settings.service";

/** GET /api/admin/settings */
export async function get(_req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.getSettings();
    res.status(200).json(settingsService.toSettingsDTO(settings));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/settings — body: Settings parcial. */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.updateSettings(req.body ?? {});
    res.status(200).json(settingsService.toSettingsDTO(settings));
  } catch (error) {
    next(error);
  }
}
