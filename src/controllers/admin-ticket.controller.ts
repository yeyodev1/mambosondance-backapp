import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as ticketService from "../services/ticket.service";

/** GET /api/admin/tickets?event=&q=&page= */
export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { event, q, page, limit } = req.query;
    const result = await ticketService.listTickets({
      event: event ? String(event) : undefined,
      q: q ? String(q) : undefined,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/tickets/verify/:code — solo consulta; no marca el ingreso. */
export async function verify(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await ticketService.verifyByCode(String(req.params.code)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/tickets/:id/check-in — 409 si ya fue usada. */
export async function checkIn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await ticketService.checkIn(String(req.params.id), req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/tickets/:id/void */
export async function voidTicket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await ticketService.voidTicket(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
