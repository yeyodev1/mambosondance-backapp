import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

/**
 * Deja `req.user` si llega un Bearer válido y sigue de largo si no.
 *
 * Es para rutas que sirven a visitantes y a alumnos a la vez (el playback de
 * una lección de muestra). Un token vencido se trata como "sin sesión": quien
 * decide si hace falta sesión es el service, que responde 401 cuando toca.
 */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as JwtPayload;
    } catch {
      // Sin sesión.
    }
  }
  next();
}
