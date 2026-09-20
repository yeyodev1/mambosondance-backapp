import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as cloudinaryService from "../services/cloudinary.service";

const FOLDERS = ["productos", "eventos", "profesores", "promos"] as const;

/**
 * Envuelve a multer: sus errores (archivo muy pesado, campo equivocado) no traen
 * status y saldrían como 500 con aviso a Slack, cuando son un 400 de quien sube.
 */
export function receiveImage(req: Request, res: Response, next: NextFunction) {
  uploadMiddleware.single("file")(req, res, (error: any) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(new CustomError("La imagen pesa más de 10 MB", 400));
    }
    next(new CustomError('Envía la imagen en el campo "file"', 400));
  });
}

/** POST /api/admin/uploads/image?folder=productos|eventos|profesores|promos — multipart, campo "file". */
export async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    const folder = String(req.query.folder ?? "");
    if (!FOLDERS.includes(folder as (typeof FOLDERS)[number])) {
      throw new CustomError(`La carpeta debe ser una de: ${FOLDERS.join(", ")}`, 400);
    }
    if (!req.file) throw new CustomError('Envía la imagen en el campo "file"', 400);
    if (!req.file.mimetype.startsWith("image/")) {
      throw new CustomError("El archivo debe ser una imagen", 400);
    }
    if (!cloudinaryService.isCloudinaryConfigured()) {
      throw new CustomError(
        "La subida de imágenes aún no está habilitada (falta configurar Cloudinary)",
        503,
      );
    }

    let image: { url: string; publicId: string };
    try {
      image = await cloudinaryService.uploadBuffer(req.file.buffer, `mambosondance/${folder}`);
    } catch (error) {
      console.error("[upload] Cloudinary falló:", error);
      throw new CustomError("No se pudo subir la imagen a Cloudinary. Intenta de nuevo.", 503);
    }
    res.status(201).json(image);
  } catch (error) {
    next(error);
  }
}
