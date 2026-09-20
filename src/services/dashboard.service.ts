import { Access } from "../models/access.model";
import { Event } from "../models/event.model";
import { Order } from "../models/order.model";
import { User } from "../models/user.model";
import { statusFilter } from "./access.service";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function getDashboard() {
  const now = new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  const paidRecently = { status: "paid", paidAt: { $gte: since } };

  const [sales, orders30d, students, activeAccesses, upcomingEvents, pendingFulfillment] =
    await Promise.all([
      Order.aggregate([
        { $match: paidRecently },
        { $group: { _id: null, total: { $sum: "$totalCents" } } },
      ]),
      Order.countDocuments(paidRecently),
      User.countDocuments({ accountType: "customer" }),
      // La cuenta demo tiene acceso a todo y no es un alumno: inflaría el número.
      Access.countDocuments({ ...statusFilter("vigente", now), source: { $ne: "demo" } }),
      Event.countDocuments({ isPublished: true, startsAt: { $gte: now } }),
      Order.countDocuments({ status: "paid", fulfillment: "pending" }),
    ]);

  return {
    salesCents30d: sales[0]?.total ?? 0,
    orders30d,
    students,
    activeAccesses,
    upcomingEvents,
    pendingFulfillment,
  };
}
