import { CustomError } from "../errors/customError.error";
import { EVENT_CATEGORIES, Event, SALES_MODES } from "../models/event.model";
import {
  Input,
  assertObjectId,
  paginated,
  parseBool,
  parseDate,
  parseEnum,
  parseGallery,
  parseImage,
  parseInteger,
  parseNullableDate,
  parseNullableInteger,
  parsePagination,
  parseRequiredText,
  parseStringList,
  parseText,
  searchRegex,
  uniqueSlug,
} from "./product.service";

// Un evento sin hora de fin sigue contando como "próximo" durante la noche en que ocurre.
const NO_END_GRACE_MS = 12 * 60 * 60 * 1000;

function upcomingFilter(now: Date) {
  return {
    $or: [
      { endsAt: { $gte: now } },
      { endsAt: null, startsAt: { $gte: new Date(now.getTime() - NO_END_GRACE_MS) } },
    ],
  };
}

function pastFilter(now: Date) {
  return {
    $or: [
      { endsAt: { $ne: null, $lt: now } },
      { endsAt: null, startsAt: { $lt: new Date(now.getTime() - NO_END_GRACE_MS) } },
    ],
  };
}

/**
 * Las tarifas conservan su _id y su contador `sold` entre ediciones: las órdenes
 * y entradas apuntan al tierId, y `sold` solo lo mueve el flujo de pago.
 */
function mergeTiers(event: any, value: unknown) {
  if (!Array.isArray(value)) throw new CustomError("Las tarifas deben ser una lista", 400);
  if (value.length > 20) throw new CustomError("Un evento admite hasta 20 tarifas", 400);

  const current: any[] = event.tiers ?? [];
  const keptIds = new Set<string>();

  const next = value.map((raw: any) => {
    const tierId = String(raw?.id ?? raw?._id ?? "");
    const existing = tierId ? current.find((tier) => String(tier._id) === tierId) : null;
    if (tierId && !existing) throw new CustomError("Hay una tarifa que no es de este evento", 400);

    const fields = {
      name: parseRequiredText(raw?.name, "El nombre de la tarifa", 120),
      priceCents: parseInteger(raw?.priceCents, "El precio de la tarifa (en centavos)"),
      availableFrom: parseNullableDate(raw?.availableFrom ?? null, "El inicio de venta"),
      availableUntil: parseNullableDate(raw?.availableUntil ?? null, "El fin de venta"),
      capacity: parseNullableInteger(raw?.capacity ?? null, "El cupo de la tarifa"),
    };
    if (
      fields.availableFrom &&
      fields.availableUntil &&
      fields.availableUntil <= fields.availableFrom
    ) {
      throw new CustomError(`La tarifa "${fields.name}" termina antes de empezar`, 400);
    }

    if (!existing) return { ...fields, sold: 0 };
    if (fields.capacity !== null && fields.capacity < existing.sold) {
      throw new CustomError(
        `La tarifa "${fields.name}" ya vendió ${existing.sold} entradas; el cupo no puede ser menor`,
        400,
      );
    }
    keptIds.add(tierId);
    return { _id: existing._id, ...fields, sold: existing.sold };
  });

  const removedWithSales = current.find((tier) => !keptIds.has(String(tier._id)) && tier.sold > 0);
  if (removedWithSales) {
    throw new CustomError(
      `No puedes quitar la tarifa "${removedWithSales.name}" porque ya tiene entradas vendidas`,
      409,
    );
  }

  event.tiers = next;
}

function applyFields(event: any, input: Input) {
  if (input.title !== undefined) event.title = parseRequiredText(input.title, "El título");
  if (input.category !== undefined) {
    event.category = parseEnum(input.category, EVENT_CATEGORIES, "La categoría");
  }
  if (input.summary !== undefined) event.summary = parseText(input.summary, "El resumen", 500);
  if (input.description !== undefined) {
    event.description = parseText(input.description, "La descripción");
  }
  if (input.startsAt !== undefined)
    event.startsAt = parseDate(input.startsAt, "La fecha de inicio");
  if (input.endsAt !== undefined) event.endsAt = parseNullableDate(input.endsAt, "La fecha de fin");
  if (input.venue !== undefined) event.venue = parseText(input.venue, "El lugar", 200);
  if (input.city !== undefined) event.city = parseText(input.city, "La ciudad", 120);
  if (input.mapUrl !== undefined)
    event.mapUrl = parseText(input.mapUrl, "El enlace del mapa", 1000);
  if (input.cover !== undefined) event.cover = parseImage(input.cover, "La portada");
  if (input.gallery !== undefined) event.gallery = parseGallery(input.gallery, "La galería");
  if (input.artists !== undefined) event.artists = parseStringList(input.artists, "Los artistas");
  if (input.salesMode !== undefined) {
    event.salesMode = parseEnum(input.salesMode, SALES_MODES, "El modo de venta");
  }
  if (input.contactUrl !== undefined) {
    event.contactUrl = parseText(input.contactUrl, "El enlace de contacto", 1000);
  }
  if (input.tiers !== undefined) mergeTiers(event, input.tiers);
  if (input.isPublished !== undefined) {
    event.isPublished = parseBool(input.isPublished, "El estado de publicación");
  }
  if (input.isFeatured !== undefined)
    event.isFeatured = parseBool(input.isFeatured, "El destacado");

  if (event.endsAt && event.startsAt && event.endsAt < event.startsAt) {
    throw new CustomError("La fecha de fin no puede ser anterior al inicio", 400);
  }
  if (event.isPublished && event.salesMode === "online" && event.tiers.length === 0) {
    throw new CustomError("Un evento con venta en línea necesita al menos una tarifa", 400);
  }
}

export async function listPublic(query: Input) {
  const { page, limit, skip } = parsePagination(query);
  const now = new Date();
  const filter: Record<string, unknown> = { isPublished: true };
  if (query.category) filter.category = parseEnum(query.category, EVENT_CATEGORIES, "La categoría");
  if (query.featured === "true" || query.featured === "1") filter.isFeatured = true;
  if (query.when === "upcoming") Object.assign(filter, upcomingFilter(now));
  else if (query.when === "past") Object.assign(filter, pastFilter(now));
  else if (query.when) throw new CustomError("El filtro when debe ser upcoming o past", 400);

  // Próximos: el más cercano primero. Pasados o sin filtro: el más reciente primero.
  const sort = query.when === "upcoming" ? { startsAt: 1 as const } : { startsAt: -1 as const };
  const [items, total] = await Promise.all([
    Event.find(filter).sort(sort).skip(skip).limit(limit),
    Event.countDocuments(filter),
  ]);
  return paginated(items, total, page, limit);
}

export async function getPublicBySlug(slug: string) {
  const event = await Event.findOne({ slug: String(slug).toLowerCase(), isPublished: true });
  if (!event) throw new CustomError("Evento no encontrado", 404);
  return event;
}

export async function adminList(query: Input) {
  const { page, limit, skip } = parsePagination(query);
  const filter: Record<string, unknown> = {};
  if (query.category) filter.category = parseEnum(query.category, EVENT_CATEGORIES, "La categoría");
  if (query.when === "upcoming") Object.assign(filter, upcomingFilter(new Date()));
  else if (query.when === "past") Object.assign(filter, pastFilter(new Date()));
  const regex = searchRegex(query.q);
  if (regex) {
    // $and: `when` ya ocupa el $or de la raíz.
    filter.$and = [{ $or: [{ title: regex }, { venue: regex }, { city: regex }] }];
  }

  const [items, total] = await Promise.all([
    Event.find(filter).sort({ startsAt: -1 }).skip(skip).limit(limit),
    Event.countDocuments(filter),
  ]);
  return paginated(items, total, page, limit);
}

export async function adminGet(id: string) {
  assertObjectId(id, "Evento no encontrado");
  const event = await Event.findById(id);
  if (!event) throw new CustomError("Evento no encontrado", 404);
  return event;
}

export async function create(input: Input) {
  const title = parseRequiredText(input.title, "El título");
  if (input.category === undefined) throw new CustomError("La categoría es obligatoria", 400);
  if (input.startsAt === undefined) throw new CustomError("La fecha de inicio es obligatoria", 400);

  const event = new Event({ title });
  applyFields(event, input);
  const slugSource = typeof input.slug === "string" && input.slug.trim() ? input.slug : title;
  event.slug = await uniqueSlug(Event, slugSource, "evento");
  await event.save();
  return event;
}

export async function update(id: string, input: Input) {
  const event = await adminGet(id);
  applyFields(event, input);
  if (typeof input.slug === "string" && input.slug.trim() && input.slug !== event.slug) {
    event.slug = await uniqueSlug(Event, input.slug, "evento", event._id);
  }
  await event.save();
  return event;
}

export async function remove(id: string): Promise<void> {
  const event = await adminGet(id);
  // Las entradas vendidas apuntan al evento: borrarlo las dejaría sin fecha ni lugar.
  if (event.tiers.some((tier: { sold: number }) => tier.sold > 0)) {
    throw new CustomError(
      "Este evento ya tiene entradas vendidas. Despublícalo en lugar de borrarlo.",
      409,
    );
  }
  await event.deleteOne();
}
