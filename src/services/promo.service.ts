import { CustomError } from "../errors/customError.error";
import { Promo } from "../models/promo.model";
import {
  Input,
  assertObjectId,
  paginated,
  parseBool,
  parseImage,
  parseInteger,
  parseNullableDate,
  parsePagination,
  parseRequiredText,
  parseText,
  searchRegex,
} from "./product.service";

const SORT = { order: 1, createdAt: -1 } as const;

function applyFields(promo: any, input: Input) {
  if (input.title !== undefined) promo.title = parseRequiredText(input.title, "El título");
  if (input.text !== undefined) promo.text = parseText(input.text, "El texto", 2000);
  if (input.image !== undefined) promo.image = parseImage(input.image, "La imagen");
  if (input.ctaLabel !== undefined) {
    promo.ctaLabel = parseText(input.ctaLabel, "El texto del botón", 60);
  }
  if (input.ctaUrl !== undefined)
    promo.ctaUrl = parseText(input.ctaUrl, "El enlace del botón", 1000);
  if (input.startsAt !== undefined) {
    promo.startsAt = parseNullableDate(input.startsAt, "La fecha de inicio");
  }
  if (input.endsAt !== undefined) promo.endsAt = parseNullableDate(input.endsAt, "La fecha de fin");
  if (input.isActive !== undefined) promo.isActive = parseBool(input.isActive, "El campo activa");
  if (input.order !== undefined) promo.order = parseInteger(input.order, "El orden");

  if (promo.startsAt && promo.endsAt && promo.endsAt <= promo.startsAt) {
    throw new CustomError("La fecha de fin debe ser posterior al inicio", 400);
  }
}

/** Activas y dentro de su ventana de fechas (sin fecha = sin límite por ese lado). */
export async function listPublic() {
  const now = new Date();
  return Promo.find({
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  }).sort(SORT);
}

export async function adminList(query: Input) {
  // Son pocas: por defecto viene la lista completa en una sola página.
  const { page, limit, skip } = parsePagination(query, 100);
  const filter: Record<string, unknown> = {};
  const regex = searchRegex(query.q);
  if (regex) filter.$or = [{ title: regex }, { text: regex }];

  const [items, total] = await Promise.all([
    Promo.find(filter).sort(SORT).skip(skip).limit(limit),
    Promo.countDocuments(filter),
  ]);
  return paginated(items, total, page, limit);
}

async function findById(id: string) {
  assertObjectId(id, "Promo no encontrada");
  const promo = await Promo.findById(id);
  if (!promo) throw new CustomError("Promo no encontrada", 404);
  return promo;
}

export async function create(input: Input) {
  const promo = new Promo({ title: parseRequiredText(input.title, "El título") });
  applyFields(promo, input);
  await promo.save();
  return promo;
}

export async function update(id: string, input: Input) {
  const promo = await findById(id);
  applyFields(promo, input);
  await promo.save();
  return promo;
}

export async function remove(id: string): Promise<void> {
  const promo = await findById(id);
  await promo.deleteOne();
}
