import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as authService from "../services/auth.service";

/** POST /api/auth/register — body: { name, email, password, phone? } */
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, password, phone } = req.body ?? {};
    const result = await authService.register({
      name: String(name ?? ""),
      email: String(email ?? ""),
      password: String(password ?? ""),
      phone: phone ? String(phone) : "",
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/login — body: { email, password } */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body ?? {};
    const result = await authService.login(String(email ?? ""), String(password ?? ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/auth/me — devuelve la sesión del token. */
export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const user = await authService.findById(req.user.userId);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

/** PUT /api/auth/password — body: { currentPassword, newPassword } */
export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { currentPassword, newPassword } = req.body ?? {};
    await authService.changePassword(
      req.user.userId,
      String(currentPassword ?? ""),
      String(newPassword ?? ""),
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/auth/profile — body: { name, phone } */
export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    const { name, phone } = req.body ?? {};
    const user = await authService.updateProfile(req.user.userId, { name, phone });
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/forgot-password — body: { email }. Responde igual exista o no la cuenta. */
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.forgotPassword(String(req.body?.email ?? ""));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

/** POST /api/auth/reset-password — body: { token, password } */
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = req.body ?? {};
    const result = await authService.resetPassword(String(token ?? ""), String(password ?? ""));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
