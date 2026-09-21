import crypto from "crypto";
import { isValidObjectId, Types } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Event } from "../models/event.model";
import { Ticket } from "../models/ticket.model";
import { escapeRegex } from "./access.service";
import { formatLongDate } from "./email.service";

type Id = string | Types.ObjectId;

// Sin 0/O ni 1/I/L: el código se dicta en la puerta y se lee en pantallas chicas.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

const EVENT_POPULATE = { path: "event", select: "title startsAt venue" };

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Forma `Ticket` del contrato. Espera `event` poblado. */
export function serializeTicket(ticket: any) {
  const event = ticket.event;
  return {
    id: String(ticket._id),
    code: ticket.code,
    event: event?._id
      ? { id: String(event._id), title: event.title, startsAt: event.startsAt, venue: event.venue }
      : { id: String(event ?? ""), title: "Evento eliminado", startsAt: null, venue: "" },
    tierName: ticket.tierName,
    holderName: ticket.holderName,
    holderEmail: ticket.holderEmail,
    order: String(ticket.order),
    status: ticket.status,
    usedAt: ticket.usedAt,
  };
}

/** Una entrada por unidad comprada. El índice único del código hace de árbitro si hubiera choque. */
export async function issueTickets(input: {
  orderId: Id;
  userId: Id;
  eventId: Id;
  tierId: string;
  tierName: string;
  holderName: string;
  holderEmail: string;
  quantity: number;
}) {
  const tickets = [];
  for (let i = 0; i < input.quantity; i++) {
    for (let attempt = 0; ; attempt++) {
      try {
        const ticket = await Ticket.create({
          code: generateCode(),
          event: input.eventId,
          tierId: input.tierId,
          tierName: input.tierName,
          holderName: input.holderName,
          holderEmail: input.holderEmail,
          user: input.userId,
          order: input.orderId,
        });
        tickets.push(ticket);
        break;
      } catch (error: any) {
        if (error?.code !== 11000 || attempt >= 4) throw error;
      }
    }
  }
  return tickets;
}

export async function listMine(userId: Id) {
  const tickets = await Ticket.find({ user: userId, status: { $ne: "void" } })
    .populate(EVENT_POPULATE)
    .sort({ createdAt: -1 });
  return tickets.map(serializeTicket);
}

/** Entradas vigentes de una orden, con `event` poblado: para la confirmación y su correo. */
export async function listByOrder(orderId: Id) {
  return Ticket.find({ order: orderId, status: { $ne: "void" } })
    .populate(EVENT_POPULATE)
    .sort({ createdAt: 1 });
}

export async function listTickets(query: {
  event?: string;
  q?: string;
  page?: number;
  limit?: number;
}) {
  const filter: Record<string, unknown> = {};
  if (query.event) {
    if (!isValidObjectId(query.event)) throw new CustomError("Evento inválido", 400);
    filter.event = query.event;
  }
  if (query.q?.trim()) {
    const pattern = new RegExp(escapeRegex(query.q.trim()), "i");
    filter.$or = [{ code: pattern }, { holderName: pattern }, { holderEmail: pattern }];
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const [items, total] = await Promise.all([
    Ticket.find(filter)
      .populate(EVENT_POPULATE)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Ticket.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeTicket),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function verifyByCode(code: string) {
  // Tolera espacios, guiones y minúsculas: en la puerta se escribe con apuro.
  const normalized = String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const ticket = normalized
    ? await Ticket.findOne({ code: normalized }).populate(EVENT_POPULATE)
    : null;
  if (!ticket) throw new CustomError("No existe ninguna entrada con ese código", 404);
  return serializeTicket(ticket);
}

async function findTicket(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Entrada no encontrada", 404);
  const ticket = await Ticket.findById(id);
  if (!ticket) throw new CustomError("Entrada no encontrada", 404);
  return ticket;
}

export async function checkIn(id: string, adminId: string) {
  if (!isValidObjectId(id)) throw new CustomError("Entrada no encontrada", 404);

  // El filtro por status hace atómico el ingreso: dos celulares escaneando la
  // misma entrada a la vez, solo uno la marca.
  const updated = await Ticket.findOneAndUpdate(
    { _id: id, status: "valid" },
    { $set: { status: "used", usedAt: new Date(), checkedInBy: adminId } },
    { new: true },
  ).populate(EVENT_POPULATE);
  if (updated) return serializeTicket(updated);

  const ticket = await findTicket(id);
  if (ticket.status === "void") throw new CustomError("Esta entrada está anulada", 409);
  throw new CustomError(
    ticket.usedAt
      ? `Esta entrada ya fue usada el ${formatLongDate(ticket.usedAt)}`
      : "Esta entrada ya fue usada",
    409,
  );
}

export async function voidTicket(id: string) {
  const ticket = await findTicket(id);
  if (ticket.status === "used") {
    throw new CustomError("Esta entrada ya fue usada y no se puede anular", 409);
  }

  if (ticket.status !== "void") {
    ticket.status = "void";
    await ticket.save();
    // Anular libera el cupo de la localidad.
    if (ticket.tierId && isValidObjectId(ticket.tierId)) {
      await Event.updateOne(
        { _id: ticket.event, tiers: { $elemMatch: { _id: ticket.tierId, sold: { $gt: 0 } } } },
        { $inc: { "tiers.$.sold": -1 } },
      );
    }
  }

  await ticket.populate(EVENT_POPULATE);
  return serializeTicket(ticket);
}
