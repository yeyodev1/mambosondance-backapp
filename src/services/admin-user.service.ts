import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Access } from "../models/access.model";
import { LoyaltyCard } from "../models/loyaltyCard.model";
import { User } from "../models/user.model";
import * as accessService from "./access.service";
import * as authService from "./auth.service";
import * as loyaltyService from "./loyalty.service";
import * as orderService from "./order.service";

export async function listUsers(query: { q?: string; page?: number; limit?: number }) {
  const filter: Record<string, unknown> = {};
  if (query.q?.trim()) {
    const pattern = new RegExp(accessService.escapeRegex(query.q.trim()), "i");
    filter.$or = [{ email: pattern }, { name: pattern }, { phone: pattern }];
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  const ids = users.map((user: any) => user._id);

  // Dos consultas para toda la página en vez de dos por alumno.
  const [accessCounts, cards] = await Promise.all([
    Access.aggregate([
      { $match: { user: { $in: ids }, ...accessService.statusFilter("vigente") } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
    LoyaltyCard.find({ user: { $in: ids } })
      .select("user stamps")
      .lean(),
  ]);
  const accessByUser = new Map(accessCounts.map((row) => [String(row._id), row.count as number]));
  const stampsByUser = new Map(cards.map((card) => [String(card.user), card.stamps?.length ?? 0]));

  return {
    items: users.map((user: any) => ({
      ...authService.sanitize(user),
      accessCount: accessByUser.get(String(user._id)) ?? 0,
      stamps: stampsByUser.get(String(user._id)) ?? 0,
      createdAt: user.createdAt,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getUserDetail(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Alumno no encontrado", 404);
  const user = await User.findById(id);
  if (!user) throw new CustomError("Alumno no encontrado", 404);

  const [accesses, orders, loyalty] = await Promise.all([
    accessService.listByUser(user._id),
    orderService.listByUser(String(user._id)),
    loyaltyService.getCard(user._id),
  ]);

  return {
    user: { ...authService.sanitize(user), createdAt: user.createdAt },
    accesses,
    orders,
    loyalty,
  };
}
