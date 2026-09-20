import { Request, Response, NextFunction } from "express";
import * as courseContentService from "../services/course-content.service";

/** POST /api/admin/products/:id/modules — body: { title } */
export async function createModule(req: Request, res: Response, next: NextFunction) {
  try {
    const module = await courseContentService.createModule(String(req.params.id), req.body ?? {});
    res.status(201).json(module);
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/modules/:id — body: { title, order } */
export async function updateModule(req: Request, res: Response, next: NextFunction) {
  try {
    const module = await courseContentService.updateModule(String(req.params.id), req.body ?? {});
    res.status(200).json(module);
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/modules/:id — borra también sus lecciones. */
export async function deleteModule(req: Request, res: Response, next: NextFunction) {
  try {
    await courseContentService.deleteModule(String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/modules/:id/lessons — body: { title, description?, isFreePreview? } */
export async function createLesson(req: Request, res: Response, next: NextFunction) {
  try {
    const lesson = await courseContentService.createLesson(String(req.params.id), req.body ?? {});
    res.status(201).json(lesson);
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/lessons/:id */
export async function updateLesson(req: Request, res: Response, next: NextFunction) {
  try {
    const lesson = await courseContentService.updateLesson(String(req.params.id), req.body ?? {});
    res.status(200).json(lesson);
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/lessons/:id */
export async function deleteLesson(req: Request, res: Response, next: NextFunction) {
  try {
    await courseContentService.deleteLesson(String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/products/:id/reorder — body: { modules: [{ id, lessons: [id] }] } */
export async function reorder(req: Request, res: Response, next: NextFunction) {
  try {
    const modules = await courseContentService.reorder(String(req.params.id), req.body ?? {});
    res.status(200).json({ modules });
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/lessons/:id/video-upload — crea el video en Bunny y firma la subida TUS. */
export async function videoUpload(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await courseContentService.startVideoUpload(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/lessons/:id/video-sync — refresca estado y duración desde Bunny. */
export async function videoSync(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await courseContentService.syncVideo(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
