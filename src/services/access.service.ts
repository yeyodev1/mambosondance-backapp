import { isValidObjectId, Types } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Access, AccessSource, IAccess } from "../models/access.model";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";
import * as authService from "./auth.service";
import * as emailService from "./email.service";

export type AccessStatus = "vigente" | "vencido" | "revocado";
type Id = string | Types.ObjectId;

/**
 * La ÚNICA definición de "vigente". La usan el reproductor, "Mis cursos", el
 * checkout y el panel admin; si la regla cambia, cambia solo acá.
 */
export function isAccessActive(
  access: Pick<IAccess, "expiresAt" | "revokedAt"> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!access) return false;
  if (access.revokedAt) return false;
  return !access.expiresAt || new Date(access.expiresAt).getTime() > now.getTime();
}

export function accessStatus(
  access: Pick<IAccess, "expiresAt" | "revokedAt">,
  now: Date = new Date(),
): AccessStatus {
  if (access.revokedAt) return "revocado";
  return isAccessActive(access, now) ? "vigente" : "vencido";
}

/** La misma regla de `isAccessActive`, expresada como filtro para listar y contar. */
export function statusFilter(
  status: AccessStatus,
  now: Date = new Date(),
): Record<string, unknown> {
  if (status === "revocado") return { revokedAt: { $ne: null } };
  if (status === "vencido") return { revokedAt: null, expiresAt: { $ne: null, $lte: now } };
  return { revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

export async function hasActiveAccess(userId: Id, productId: Id): Promise<boolean> {
  const access = await Access.findOne({ user: userId, product: productId });
  return isAccessActive(access);
}

/** Vencimiento de una compra hecha ahora. `null` = de por vida. */
export function expiryFromDuration(days: number | null | undefined, from: Date = new Date()) {
  if (!days || days <= 0) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function grantAccess(input: {
  userId: Id;
  productId: Id;
  source: AccessSource;
  expiresAt: Date | null;
  orderId?: Id | null;
  grantedBy?: Id | null;
  note?: string;
}) {
  // Upsert sobre el índice único user+product: volver a otorgar reactiva el
  // mismo registro (limpia la revocación y los avisos ya enviados).
  return Access.findOneAndUpdate(
    { user: input.userId, product: input.productId },
    {
      $set: {
        source: input.source,
        expiresAt: input.expiresAt,
        order: input.orderId ?? null,
        grantedBy: input.grantedBy ?? null,
        note: input.note ?? "",
        revokedAt: null,
        reminder7SentAt: null,
        reminder0SentAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/** Forma `Access` del contrato. Espera `user` y `product` poblados. */
export function serializeAccess(access: any) {
  const user = access.user;
  const product = access.product;
  return {
    id: String(access._id),
    user: user?._id
      ? { id: String(user._id), email: user.email, name: user.name }
      : { id: String(user ?? ""), email: "", name: "" },
    product: product?._id
      ? { id: String(product._id), title: product.title, slug: product.slug }
      : { id: String(product ?? ""), title: "Producto eliminado", slug: "" },
    source: access.source,
    note: access.note,
    expiresAt: access.expiresAt,
    revokedAt: access.revokedAt,
    status: accessStatus(access),
    createdAt: access.createdAt,
  };
}

const POPULATE = [
  { path: "user", select: "email name" },
  { path: "product", select: "title slug" },
];

/**
 * `expiresAt` debe venir SIEMPRE decidido: fecha futura o `null` explícito.
 * Un default silencioso termina regalando acceso de por vida, o cortándolo,
 * sin que nadie lo haya elegido.
 */
export function parseExpiresAt(body: Record<string, unknown> | undefined): Date | null {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "expiresAt")) {
    throw new CustomError(
      'Elige el vencimiento: una fecha o "No se revoca". No puede quedar vacío',
      400,
    );
  }
  const raw = body.expiresAt;
  if (raw === null) return null;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new CustomError("La fecha de vencimiento no es válida", 400);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new CustomError("La fecha de vencimiento no es válida", 400);
  }
  if (date.getTime() <= Date.now()) {
    throw new CustomError("La fecha de vencimiento debe ser futura", 400);
  }
  return date;
}

/** Acceso manual desde el admin: crea la cuenta si hace falta y avisa por correo. */
export async function grantManual(input: {
  email: string;
  productIds: unknown;
  expiresAt: Date | null;
  note?: string;
  grantedBy: string;
}) {
  const ids = Array.isArray(input.productIds) ? [...new Set(input.productIds.map(String))] : [];
  if (!ids.length) throw new CustomError("Elige al menos un curso", 400);
  if (ids.some((id) => !isValidObjectId(id))) throw new CustomError("Curso inválido", 400);

  const products: any[] = await Product.find({ _id: { $in: ids } });
  if (products.length !== ids.length) throw new CustomError("Alguno de los cursos no existe", 404);
  if (products.some((product) => product.type !== "course")) {
    throw new CustomError("Solo se puede dar acceso a cursos", 400);
  }

  const { user, created, setPasswordUrl } = await authService.findOrCreateUserByEmail(input.email);

  const accesses = [];
  for (const product of products) {
    const access = await grantAccess({
      userId: user._id,
      productId: product._id,
      source: "manual",
      expiresAt: input.expiresAt,
      grantedBy: input.grantedBy,
      note: (input.note || "").trim(),
    });
    accesses.push(access);
  }

  // Primero la cuenta: el segundo correo invita a entrar y necesita contraseña.
  if (created && setPasswordUrl) {
    await emailService.sendAccountCreated(user.email, user.name, setPasswordUrl);
  }
  await emailService.sendAccessGranted(user.email, {
    name: user.name,
    productTitles: products.map((product) => product.title),
    expiresAt: input.expiresAt,
    productSlug: products.length === 1 ? products[0].slug : undefined,
  });

  const populated = await Access.find({ _id: { $in: accesses.map((access) => access._id) } })
    .populate(POPULATE)
    .sort({ createdAt: -1 });
  return populated.map(serializeAccess);
}

export async function listAccesses(query: {
  product?: string;
  user?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const filter: Record<string, unknown> = {};

  if (query.product) {
    if (!isValidObjectId(query.product)) throw new CustomError("Producto inválido", 400);
    filter.product = query.product;
  }

  if (query.user) {
    // Acepta el id o un texto para buscar por correo o nombre desde el panel.
    if (isValidObjectId(query.user)) {
      filter.user = query.user;
    } else {
      const pattern = new RegExp(escapeRegex(query.user.trim()), "i");
      const users = await User.find({ $or: [{ email: pattern }, { name: pattern }] })
        .select("_id")
        .limit(200);
      filter.user = { $in: users.map((user: any) => user._id) };
    }
  }

  if (query.status) {
    if (!["vigente", "vencido", "revocado"].includes(query.status)) {
      throw new CustomError("Estado inválido", 400);
    }
    Object.assign(filter, statusFilter(query.status as AccessStatus));
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const [items, total] = await Promise.all([
    Access.find(filter)
      .populate(POPULATE)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Access.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeAccess),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function listByUser(userId: Id) {
  const items = await Access.find({ user: userId }).populate(POPULATE).sort({ createdAt: -1 });
  return items.map(serializeAccess);
}

async function findAccess(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Acceso no encontrado", 404);
  const access = await Access.findById(id);
  if (!access) throw new CustomError("Acceso no encontrado", 404);
  return access;
}

/** Cambia o quita el vencimiento. No toca la revocación: para eso está otorgar de nuevo. */
export async function patchAccess(id: string, expiresAt: Date | null) {
  const access = await findAccess(id);
  access.expiresAt = expiresAt;
  // Fecha nueva, avisos nuevos.
  access.reminder7SentAt = null;
  access.reminder0SentAt = null;
  await access.save();
  await access.populate(POPULATE);
  return serializeAccess(access);
}

/** No se borra el documento: el historial sirve para soporte. */
export async function revokeAccess(id: string) {
  const access = await findAccess(id);
  if (!access.revokedAt) {
    access.revokedAt = new Date();
    await access.save();
  }
  await access.populate(POPULATE);
  return serializeAccess(access);
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Avisos de vencimiento (cron diario) ───────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
// Ecuador no tiene horario de verano: UTC-5 fijo. "Hoy" es el día de Guayaquil,
// no el del servidor, para que "vence hoy" coincida con lo que ve el alumno.
const ECUADOR_OFFSET_MS = -5 * 60 * 60 * 1000;
const REMINDER_BATCH = 150;

function startOfEcuadorDay(now: Date): Date {
  const local = new Date(now.getTime() + ECUADOR_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - ECUADOR_OFFSET_MS);
}

/**
 * No corta accesos (eso se evalúa en cada petición): solo avisa. Un correo
 * hasta 7 días antes y otro el día del vencimiento. La marca se guarda solo si
 * Resend aceptó el envío, así un fallo se reintenta en la corrida siguiente.
 */
export async function sendExpiryReminders(now: Date = new Date()) {
  const todayStart = startOfEcuadorDay(now);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);
  const weekEnd = new Date(todayStart.getTime() + 8 * DAY_MS);
  const base = { revokedAt: null, source: { $ne: "demo" } };

  const result = { expiringToday: 0, expiringSoon: 0, failed: 0 };

  const notify = async (access: any, field: "reminder0SentAt" | "reminder7SentAt") => {
    const user = access.user;
    const product = access.product;
    if (!user?.email || !product?._id) return;

    const daysLeft =
      field === "reminder0SentAt"
        ? 0
        : Math.round(
            (startOfEcuadorDay(access.expiresAt).getTime() - todayStart.getTime()) / DAY_MS,
          );

    const sent = await emailService.sendAccessExpiring(user.email, {
      name: user.name,
      productTitle: product.title,
      productSlug: product.slug,
      daysLeft,
      expiresAt: access.expiresAt,
    });
    if (!sent) {
      result.failed += 1;
      return;
    }
    await Access.updateOne({ _id: access._id }, { $set: { [field]: new Date() } });
    if (field === "reminder0SentAt") result.expiringToday += 1;
    else result.expiringSoon += 1;
  };

  const today = await Access.find({
    ...base,
    expiresAt: { $gte: todayStart, $lt: todayEnd },
    reminder0SentAt: null,
  })
    .populate(POPULATE)
    .limit(REMINDER_BATCH);
  for (const access of today) await notify(access, "reminder0SentAt");

  const soon = await Access.find({
    ...base,
    expiresAt: { $gte: todayEnd, $lt: weekEnd },
    reminder7SentAt: null,
  })
    .populate(POPULATE)
    .limit(REMINDER_BATCH);
  for (const access of soon) await notify(access, "reminder7SentAt");

  return result;
}
