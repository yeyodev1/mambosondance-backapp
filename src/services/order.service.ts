import crypto from "crypto";
import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Access } from "../models/access.model";
import { nextSequence } from "../models/counter.model";
import { Event } from "../models/event.model";
import {
  FULFILLMENT_STATUSES,
  FulfillmentStatus,
  IOrderItem,
  IShipping,
  ORDER_STATUSES,
  Order,
} from "../models/order.model";
import { Product } from "../models/product.model";
import { ResendLog } from "../models/resendLog.model";
import { User } from "../models/user.model";
import * as accessService from "./access.service";
import * as authService from "./auth.service";
import * as emailService from "./email.service";
import * as loyaltyService from "./loyalty.service";
import * as payphoneService from "./payphone.service";
import { getSettings } from "./settings.service";
import * as ticketService from "./ticket.service";

const MAX_LINES = 20;
const MAX_PHYSICAL_QUANTITY = 20;
const MAX_TICKET_QUANTITY = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_WINDOW_MS = 15 * 60 * 1000;
const RESEND_MAX = 3;
const RESEND_ORDERS = 5;

interface Requester {
  userId: string;
  accountType: string;
}

/** `payphoneResponse` es para soporte y conciliación; nunca sale hacia el navegador. */
export function serializeOrder(order: any): Record<string, unknown> {
  const json = typeof order?.toJSON === "function" ? order.toJSON() : { ...order };
  delete json.payphoneResponse;
  return json;
}

// ─── Crear ─────────────────────────────────────────────────────────────

function text(value: unknown, max = 200): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function parseQuantity(value: unknown, max: number, label: string): number {
  const quantity = Number(value ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new CustomError(`La cantidad de ${label} no es válida`, 400);
  }
  if (quantity > max) {
    throw new CustomError(`Puedes llevar máximo ${max} unidades de ${label} por pedido`, 400);
  }
  return quantity;
}

/** `accountEmail` = correo de la sesión: manda sobre lo que venga en el body. */
function parseBuyer(input: any, accountEmail: string | null) {
  const buyer = {
    name: text(input?.name, 120),
    email: accountEmail ?? text(input?.email, 160).toLowerCase(),
    phone: text(input?.phone, 30),
    documentId: text(input?.documentId, 20).replace(/\s+/g, ""),
  };
  if (!buyer.name) throw new CustomError("Escribe el nombre de quien compra", 400);
  if (!EMAIL.test(buyer.email)) {
    throw new CustomError("Escribe un correo válido: ahí te llegan tus accesos", 400);
  }
  if (buyer.phone.replace(/\D/g, "").length < 7) {
    throw new CustomError("Escribe un número de teléfono válido", 400);
  }
  if (!/^[A-Za-z0-9-]{5,20}$/.test(buyer.documentId)) {
    throw new CustomError("Escribe un número de cédula, RUC o pasaporte válido", 400);
  }
  return buyer;
}

function parseShipping(input: any): IShipping {
  const shipping = {
    fullName: text(input?.fullName, 120),
    phone: text(input?.phone, 30),
    city: text(input?.city, 80),
    address: text(input?.address, 300),
    notes: text(input?.notes, 500),
  };
  if (!shipping.fullName || !shipping.phone || !shipping.city || !shipping.address) {
    throw new CustomError("Completa los datos de envío: nombre, teléfono, ciudad y dirección", 400);
  }
  return shipping;
}

/** Payphone espera el teléfono en formato internacional; los locales de Ecuador se completan. */
function toPayphonePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("593")) return `+${digits}`;
  if (digits.startsWith("0")) return `+593${digits.slice(1)}`;
  return `+593${digits}`;
}

/** Valida las variantes elegidas contra las del producto y descarta cualquier clave extra. */
function parseSelectedOptions(product: any, input: unknown): Record<string, string> {
  const chosen = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const result: Record<string, string> = {};
  for (const variant of product.variants ?? []) {
    const value = String(chosen[variant.name] ?? "").trim();
    if (!value) throw new CustomError(`Elige ${variant.name} para ${product.title}`, 400);
    if (!variant.options.includes(value)) {
      throw new CustomError(
        `${variant.name} "${value}" no está disponible en ${product.title}`,
        400,
      );
    }
    result[variant.name] = value;
  }
  return result;
}

function tierIsOnSale(tier: any, now: Date): boolean {
  if (tier.availableFrom && new Date(tier.availableFrom).getTime() > now.getTime()) return false;
  if (tier.availableUntil && new Date(tier.availableUntil).getTime() < now.getTime()) return false;
  return true;
}

/**
 * Arma los ítems desde la base: título, precio e imagen salen del catálogo y
 * cualquier precio que mande el navegador se ignora.
 *
 * `userId` null = compra sin sesión con un correo que aún no tiene cuenta: no
 * hay accesos previos que revisar. `guest` solo cambia el mensaje del 409.
 */
async function buildItems(
  userId: string | null,
  rawItems: unknown,
  guest: boolean,
): Promise<IOrderItem[]> {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new CustomError("Tu carrito está vacío", 400);
  }
  if (rawItems.length > MAX_LINES) {
    throw new CustomError(`Un pedido puede tener máximo ${MAX_LINES} líneas`, 400);
  }

  const now = new Date();
  const items: IOrderItem[] = [];
  // Una misma camiseta en dos tallas, o la misma localidad dos veces, comparten
  // stock y cupo: se valida la suma, no cada línea por separado.
  const stockNeeded = new Map<string, number>();
  const seatsNeeded = new Map<string, number>();
  const courses = new Set<string>();

  for (const raw of rawItems as any[]) {
    if (raw?.kind === "product") {
      if (!isValidObjectId(raw.productId)) throw new CustomError("Producto inválido", 400);
      const product: any = await Product.findById(raw.productId);
      if (!product || !product.isPublished) {
        throw new CustomError("Uno de los productos ya no está disponible", 404);
      }
      const productId = String(product._id);

      if (product.type === "course") {
        // Un curso se compra una sola vez: repetirlo en el carrito no lo duplica.
        if (courses.has(productId)) continue;
        courses.add(productId);
        if (userId && (await accessService.hasActiveAccess(userId, product._id))) {
          throw new CustomError(
            guest
              ? `Este correo ya tiene acceso a ${product.title}. Inicia sesión para verlo.`
              : `Ya tienes acceso vigente a ${product.title}`,
            409,
          );
        }
        items.push({
          kind: "product",
          product: product._id,
          event: null,
          tierId: null,
          title: product.title,
          unitCents: product.priceCents,
          quantity: 1,
          selectedOptions: {},
          image: product.cover?.url ?? null,
          productType: "course",
        });
        continue;
      }

      const quantity = parseQuantity(raw.quantity, MAX_PHYSICAL_QUANTITY, product.title);
      const needed = (stockNeeded.get(productId) ?? 0) + quantity;
      stockNeeded.set(productId, needed);
      if (product.stock !== null && product.stock !== undefined && needed > product.stock) {
        throw new CustomError(
          product.stock > 0
            ? `Solo ${product.stock === 1 ? "queda 1 unidad" : `quedan ${product.stock} unidades`} de ${product.title}`
            : `${product.title} está agotado`,
          409,
        );
      }

      items.push({
        kind: "product",
        product: product._id,
        event: null,
        tierId: null,
        title: product.title,
        unitCents: product.priceCents,
        quantity,
        selectedOptions: parseSelectedOptions(product, raw.selectedOptions),
        image: product.cover?.url ?? null,
        productType: "physical",
      });
      continue;
    }

    if (raw?.kind === "ticket") {
      if (!isValidObjectId(raw.eventId) || !isValidObjectId(raw.tierId)) {
        throw new CustomError("Entrada inválida", 400);
      }
      const event: any = await Event.findById(raw.eventId);
      if (!event || !event.isPublished) {
        throw new CustomError("Uno de los eventos ya no está disponible", 404);
      }
      if (event.salesMode !== "online") {
        throw new CustomError(`Las entradas de ${event.title} no se venden en línea`, 400);
      }
      if (new Date(event.endsAt ?? event.startsAt).getTime() < now.getTime()) {
        throw new CustomError(`${event.title} ya pasó`, 409);
      }

      const tier = event.tiers.id(raw.tierId);
      if (!tier) throw new CustomError(`Esa localidad de ${event.title} ya no existe`, 404);
      if (!tierIsOnSale(tier, now)) {
        throw new CustomError(
          `${tier.name} de ${event.title} no está a la venta en este momento`,
          409,
        );
      }

      const quantity = parseQuantity(raw.quantity, MAX_TICKET_QUANTITY, `${tier.name}`);
      const tierId = String(tier._id);
      const needed = (seatsNeeded.get(tierId) ?? 0) + quantity;
      seatsNeeded.set(tierId, needed);
      if (tier.capacity !== null && tier.capacity !== undefined) {
        const left = Math.max(tier.capacity - tier.sold, 0);
        if (needed > left) {
          throw new CustomError(
            left > 0
              ? `Solo ${left === 1 ? "queda 1 entrada" : `quedan ${left} entradas`} de ${tier.name} para ${event.title}`
              : `${tier.name} de ${event.title} está agotada`,
            409,
          );
        }
      }

      items.push({
        kind: "ticket",
        product: null,
        event: event._id,
        tierId,
        title: `${event.title} · ${tier.name}`,
        unitCents: tier.priceCents,
        quantity,
        selectedOptions: {},
        image: event.cover?.url ?? null,
        productType: null,
      });
      continue;
    }

    throw new CustomError("Hay un ítem inválido en tu carrito", 400);
  }

  if (!items.length) throw new CustomError("Tu carrito está vacío", 400);
  return items;
}

/**
 * Una cuenta nacida de una compra sin sesión que se abandonó sigue siendo "de
 * quien compra" en el siguiente intento (tarjeta rechazada, pestaña cerrada):
 * nunca entró nadie, no tiene nada pagado ni ningún acceso. Fuera de ese caso
 * una cuenta existente jamás entrega sesión por comprar con su correo.
 */
async function isUnclaimedGuestAccount(user: any): Promise<boolean> {
  if (user.lastLoginAt || user.accountType !== "customer") return false;
  const [bornFromCheckout, hasPaid, hasAccess] = await Promise.all([
    Order.exists({ user: user._id, accountCreated: true }),
    Order.exists({ user: user._id, status: "paid" }),
    Access.exists({ user: user._id }),
  ]);
  return Boolean(bornFromCheckout) && !hasPaid && !hasAccess;
}

/** `sessionUserId` undefined = compra sin cuenta: la orden se asocia al correo de `buyer`. */
export async function createOrder(sessionUserId: string | undefined, body: any) {
  if (!payphoneService.isPayphoneConfigured()) {
    throw new CustomError("Los pagos en línea aún no están habilitados", 503);
  }

  const guest = !sessionUserId;
  let user: any = null;
  if (sessionUserId) {
    user = await User.findById(sessionUserId);
    if (!user || !user.isActive) throw new CustomError("No autorizado", 401);
  }

  const buyer = parseBuyer(body?.buyer, user ? user.email : null);
  if (guest) {
    user = await User.findOne({ email: buyer.email });
    if (user && !user.isActive) {
      throw new CustomError(
        "No podemos procesar compras con este correo. Escríbenos y te ayudamos",
        403,
      );
    }
  }

  const items = await buildItems(user ? String(user._id) : null, body?.items, guest);

  const hasPhysical = items.some((item) => item.productType === "physical");
  const shipping = hasPhysical ? parseShipping(body?.shipping) : null;

  const subtotalCents = items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);
  const discountCents = 0;
  const totalCents = subtotalCents - discountCents;
  if (totalCents <= 0) {
    throw new CustomError("El total del pedido debe ser mayor a cero", 400);
  }

  // La cuenta se crea al final, con el carrito ya validado: un 400 no deja
  // cuentas huérfanas. Va en silencio, sin correo de "cuenta creada": todavía
  // no ha pagado, y todo lo que necesita llega en el correo de compra.
  let accountCreated = false;
  if (guest) {
    if (user) {
      accountCreated = await isUnclaimedGuestAccount(user);
    } else {
      const result = await authService.findOrCreateUserByEmail(buyer.email, buyer.name);
      user = result.user;
      accountCreated = result.created;
    }
  }

  const seq = await nextSequence("order");
  const number = `MS-${String(seq).padStart(6, "0")}`;
  // Único por intento y de máximo 50 caracteres (límite de Payphone). El sufijo
  // aleatorio evita que alguien adivine el de otra orden.
  const clientTransactionId = `MS${String(seq).padStart(6, "0")}-${crypto.randomBytes(8).toString("hex")}`;

  const order = await Order.create({
    number,
    user: user._id,
    email: user.email,
    items,
    subtotalCents,
    discountCents,
    totalCents,
    status: "pending",
    // Pasa a "pending" recién cuando se paga: una orden sin pagar no se despacha.
    fulfillment: "none",
    shipping,
    buyer,
    clientTransactionId,
    accountCreated,
  });

  const { token, storeId } = payphoneService.boxCredentials();

  return {
    order: serializeOrder(order),
    payphone: {
      token,
      storeId,
      clientTransactionId,
      amount: totalCents,
      // Precios finales: por ahora todo el monto va como "sin impuestos". El
      // desglose de IVA (amountWithTax + tax) está pendiente de confirmar con el
      // cliente; cuando se defina, Payphone exige amount = amountWithoutTax + amountWithTax + tax.
      amountWithoutTax: totalCents,
      currency: "USD" as const,
      reference: `MamboSon pedido ${number}`.slice(0, 100),
      email: user.email,
      phoneNumber: toPayphonePhone(buyer.phone),
      documentId: buyer.documentId,
    },
  };
}

// ─── Correo de compra ──────────────────────────────────────────────────

function hasPhysicalItems(order: any): boolean {
  return (order.items as IOrderItem[]).some((item) => item.productType === "physical");
}

/** Cursos de la orden con su slug actual. El título es el de la compra. */
async function orderCourses(order: any, skip?: Set<string>) {
  const items = (order.items as IOrderItem[]).filter(
    (item) => item.productType === "course" && item.product && !skip?.has(String(item.product)),
  );
  if (!items.length) return [];
  const products: any[] = await Product.find({
    _id: { $in: items.map((item) => item.product) },
  }).select("slug");
  const slugs = new Map(products.map((product) => [String(product._id), product.slug]));
  return items.map((item) => ({
    title: item.title,
    slug: String(slugs.get(String(item.product)) ?? ""),
  }));
}

/**
 * Enlace para definir contraseña si la cuenta nunca inició sesión; null si ya
 * sabe entrar. Cada enlace nuevo invalida el anterior: se pide uno por envío,
 * no uno por correo.
 */
async function setPasswordUrlFor(userId: unknown): Promise<string | null> {
  const user: any = await User.findById(userId).select("lastLoginAt isActive");
  if (!user || !user.isActive || user.lastLoginAt) return null;
  return authService.issueSetPasswordUrl(user._id);
}

/**
 * El mismo correo sirve para la compra recién pagada y para "Encontrar mi
 * compra". Las entradas se leen de la base para que un reenvío traiga los
 * mismos códigos y deje fuera las anuladas.
 */
async function sendOrderEmail(
  order: any,
  options: {
    settings?: any;
    failedCourses?: Set<string>;
    // undefined = se calcula acá; string o null = ya lo resolvió quien llama.
    setPasswordUrl?: string | null;
    isResend?: boolean;
  } = {},
): Promise<boolean> {
  const settings = options.settings ?? (await getSettings().catch(() => null));
  const [tickets, courses, account] = await Promise.all([
    ticketService.listByOrder(order._id),
    orderCourses(order, options.failedCourses),
    User.findById(order.user).select("name"),
  ]);
  const setPasswordUrl =
    options.setPasswordUrl === undefined
      ? await setPasswordUrlFor(order.user)
      : options.setPasswordUrl;

  return emailService.sendOrderPaid(order.email, {
    name: order.buyer?.name || (account as any)?.name,
    number: order.number,
    items: (order.items as IOrderItem[]).map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unitCents: item.unitCents,
      detail: Object.entries(item.selectedOptions ?? {})
        .map(([name, value]) => `${name}: ${value}`)
        .join(" · "),
    })),
    totalCents: order.totalCents,
    tickets: tickets.map((ticket: any) => ({
      code: ticket.code,
      eventTitle: ticket.event?.title ?? "Evento",
      tierName: ticket.tierName,
      startsAt: ticket.event?.startsAt ?? null,
    })),
    courses,
    hasPhysical: hasPhysicalItems(order),
    shippingNote: settings?.shippingNote,
    setPasswordUrl,
    isResend: options.isResend,
  });
}

// ─── Confirmar ─────────────────────────────────────────────────────────

/**
 * Todo lo que se entrega al pagar. Solo lo ejecuta quien ganó la transición
 * atómica a "paid", así que corre una vez por orden. Cada paso va aislado: si
 * falla el correo o un sello, el alumno igual recibe sus accesos y entradas.
 */
async function fulfillOrder(order: any): Promise<void> {
  const tag = `[order ${order.number}]`;
  const settings: any = await getSettings().catch(() => null);
  const paidAt: Date = order.paidAt ?? new Date();

  // Cursos cuyo acceso no se pudo otorgar: el correo no debe prometerlos.
  const failedCourses = new Set<string>();
  let stamps = 0;

  for (const item of order.items as IOrderItem[]) {
    try {
      if (item.kind === "product" && item.productType === "course" && item.product) {
        const product: any = await Product.findById(item.product);
        await accessService.grantAccess({
          userId: order.user,
          productId: item.product,
          source: "purchase",
          expiresAt: accessService.expiryFromDuration(product?.accessDurationDays, paidAt),
          orderId: order._id,
          note: `Compra ${order.number}`,
        });
        stamps += 1;
      }

      if (item.kind === "product" && item.productType === "physical" && item.product) {
        // stock null = sin control de inventario: no hay nada que descontar.
        await Product.updateOne(
          { _id: item.product, stock: { $ne: null } },
          { $inc: { stock: -item.quantity } },
        );
      }

      if (item.kind === "ticket" && item.event && item.tierId) {
        const event: any = await Event.findById(item.event);
        const tier = event?.tiers?.id(item.tierId);
        await ticketService.issueTickets({
          orderId: order._id,
          userId: order.user,
          eventId: item.event,
          tierId: item.tierId,
          tierName: tier?.name ?? item.title,
          holderName: order.buyer?.name ?? "",
          holderEmail: order.email,
          quantity: item.quantity,
        });
        await Event.updateOne(
          { _id: item.event, "tiers._id": item.tierId },
          { $inc: { "tiers.$.sold": item.quantity } },
        );
        // Un taller cuenta para la tarjeta igual que un curso; una fiesta no.
        if (event?.category === "taller") stamps += 1;
      }
    } catch (error) {
      console.error(`${tag} falló la entrega de "${item.title}":`, error);
      if (item.productType === "course" && item.product) failedCourses.add(String(item.product));
    }
  }

  // El correo de compra va antes que el de sello para que lleguen en orden lógico.
  try {
    await sendOrderEmail(order, { settings, failedCourses });
  } catch (error) {
    console.error(`${tag} falló el correo de compra:`, error);
  }

  if (stamps > 0 && settings?.loyaltyEnabled && settings?.loyaltyStampOnPurchase) {
    try {
      await loyaltyService.addStamp({
        userId: order.user,
        source: "purchase",
        note: `Compra ${order.number}`,
        count: stamps,
      });
    } catch (error) {
      console.error(`${tag} falló el sello de fidelidad:`, error);
    }
  }
}

type ConfirmStatus = "paid" | "canceled" | "failed";

export interface OrderConfirmation {
  order: Record<string, unknown>;
  status: ConfirmStatus;
  tickets: ReturnType<typeof ticketService.serializeTicket>[];
  courses: { slug: string; title: string }[];
  hasPhysical: boolean;
  /** A dónde se enviaron los accesos. */
  email: string;
  session: { token: string; user: authService.SessionUser } | null;
}

/**
 * Cierra el caso de quien deja una orden pendiente con el correo de otra
 * persona y la paga después de que esa persona compró: la sesión solo se
 * entrega si en la cuenta no había nada antes de esta orden (ni compras pagadas
 * ni accesos dados por el equipo). Mira hacia atrás y no hacia adelante para
 * que recargar la página siga devolviendo la sesión aunque luego compre más.
 */
async function accountHoldsOnlyThisOrder(order: any): Promise<boolean> {
  const [earlierPaid, grantedByTeam] = await Promise.all([
    Order.exists({
      user: order.user,
      status: "paid",
      _id: { $ne: order._id },
      paidAt: { $lte: order.paidAt ?? new Date() },
    }),
    Access.exists({ user: order.user, source: { $ne: "purchase" } }),
  ]);
  return !earlierPaid && !grantedByTeam;
}

/**
 * Respuesta de la página de pago. Se arma siempre desde la base, así una
 * recarga devuelve exactamente lo mismo que la primera vez.
 */
async function buildConfirmation(order: any, status: ConfirmStatus): Promise<OrderConfirmation> {
  const paid = status === "paid";
  const [tickets, courses] = paid
    ? await Promise.all([ticketService.listByOrder(order._id), orderCourses(order)])
    : [[], []];

  // Solo la compra que creó la cuenta entrega sesión: comprar con el correo de
  // una cuenta ajena nunca debe abrirla. `sessionForNewAccount` deja de
  // entregarla en cuanto esa cuenta inicia sesión por su lado.
  const session =
    paid && order.accountCreated && (await accountHoldsOnlyThisOrder(order))
      ? await authService.sessionForNewAccount(order.user)
      : null;

  return {
    order: serializeOrder(order),
    status,
    tickets: tickets.map(ticketService.serializeTicket),
    // Sin slug (producto borrado) no hay a dónde enlazar desde la página.
    courses: courses.filter((course) => course.slug),
    hasPhysical: hasPhysicalItems(order),
    email: order.email,
    session,
  };
}

/**
 * Cobra la orden contra Payphone. Idempotente: la página de respuesta se
 * recarga más de lo que uno cree, y una orden ya pagada responde lo mismo sin
 * duplicar accesos, entradas ni correos.
 */
async function settleOrder(
  order: any,
  payphoneId: string,
  clientTransactionId: string,
): Promise<{ order: any; status: ConfirmStatus }> {
  if (order.status === "paid") return { order, status: "paid" };
  if (order.status === "canceled") return { order, status: "canceled" };

  const data = await payphoneService.confirmTransaction(payphoneId, clientTransactionId);
  const record = { payphoneId, payphoneResponse: data };
  // "failed" se puede reintentar: Payphone a veces responde error y segundos después aprueba.
  const open = { _id: order._id, status: { $in: ["pending", "failed"] } };

  const belongsToOrder =
    !data.clientTransactionId || String(data.clientTransactionId) === clientTransactionId;

  if (data.statusCode === payphoneService.PAYPHONE_APPROVED && belongsToOrder) {
    // Sin esta comparación alguien podría pagar una transacción barata y
    // confirmar con ella una orden cara.
    if (Number(data.amount) !== order.totalCents) {
      console.error(
        `[order ${order.number}] monto de Payphone (${data.amount}) distinto al de la orden (${order.totalCents}); no se entrega nada`,
      );
      const failed = await Order.findOneAndUpdate(
        open,
        { $set: { ...record, status: "failed" } },
        { new: true },
      );
      return { order: failed ?? order, status: "failed" };
    }

    const paid = await Order.findOneAndUpdate(
      open,
      {
        $set: {
          ...record,
          status: "paid",
          paidAt: new Date(),
          fulfillment: hasPhysicalItems(order) ? "pending" : "none",
        },
      },
      { new: true },
    );

    // null = otra petición ganó la carrera y ya está entregando; no se repite.
    if (paid) {
      await fulfillOrder(paid);
      return { order: paid, status: "paid" };
    }
    const current = await Order.findById(order._id);
    return {
      order: current ?? order,
      status: current?.status === "paid" ? "paid" : "failed",
    };
  }

  const status: ConfirmStatus =
    data.statusCode === payphoneService.PAYPHONE_CANCELED && belongsToOrder ? "canceled" : "failed";
  const updated = await Order.findOneAndUpdate(
    open,
    { $set: { ...record, status } },
    { new: true },
  );
  if (updated) return { order: updated, status };

  const current = await Order.findById(order._id);
  return {
    order: current ?? order,
    status: current?.status === "paid" ? "paid" : status,
  };
}

/**
 * Se compra sin cuenta, así que acá no se exige sesión: `clientTransactionId`
 * es aleatorio e inadivinable y hace de credencial de quien compró. Por eso la
 * orden se busca SOLO por él, nunca por un id que se pueda enumerar.
 */
export async function confirmOrder(
  requester: Requester | undefined,
  input: { id: unknown; clientTransactionId: unknown },
): Promise<OrderConfirmation> {
  const clientTransactionId = text(input.clientTransactionId, 60);
  const payphoneId = text(input.id, 30);
  if (!clientTransactionId || !/^\d+$/.test(payphoneId)) {
    throw new CustomError("Faltan los datos de la transacción", 400);
  }

  const order = await Order.findOne({ clientTransactionId });
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (requester && String(order.user) !== requester.userId && requester.accountType !== "admin") {
    throw new CustomError("Este pedido no es tuyo", 403);
  }

  const settled = await settleOrder(order, payphoneId, clientTransactionId);
  return buildConfirmation(settled.order, settled.status);
}

// ─── Encontrar mi compra ───────────────────────────────────────────────

/**
 * true si este correo todavía puede pedir un reenvío. Se registra primero y se
 * cuenta después: con dos peticiones a la vez, contar antes dejaría pasar a
 * ambas. El intento rechazado se borra para que insistir no alargue el bloqueo.
 */
async function takeResendSlot(email: string): Promise<boolean> {
  const entry = await ResendLog.create({ email });
  const recent = await ResendLog.countDocuments({
    email,
    createdAt: { $gte: new Date(Date.now() - RESEND_WINDOW_MS) },
  });
  if (recent <= RESEND_MAX) return true;
  await ResendLog.deleteOne({ _id: entry._id });
  return false;
}

/**
 * Reenvía la confirmación de las órdenes pagadas de un correo. No devuelve ni
 * lanza nada que delate si el correo existe: el controller responde
 * `{ ok: true }` pase lo que pase acá.
 */
export async function findPurchase(input: { email?: unknown; number?: unknown }): Promise<void> {
  const email = text(input?.email, 160).toLowerCase();
  if (!EMAIL.test(email)) return;

  // Por usuario y no por `Order.email`: ese campo no tiene índice y `user` sí.
  const user: any = await User.findOne({ email }).select("_id isActive");
  if (!user || !user.isActive) return;

  const filter: Record<string, unknown> = { user: user._id, status: "paid" };
  const number = text(input?.number, 20).toUpperCase();
  if (number) filter.number = number;

  const orders = await Order.find(filter).sort({ paidAt: -1 }).limit(RESEND_ORDERS);
  if (!orders.length) return;
  if (!(await takeResendSlot(email))) return;

  // Un solo enlace para todos los correos de este envío: cada enlace nuevo
  // invalida el anterior y solo serviría el del último correo.
  const setPasswordUrl = await setPasswordUrlFor(user._id);
  const settings = await getSettings().catch(() => null);

  // De la más antigua a la más reciente, para que la última quede arriba en la bandeja.
  for (const order of orders.reverse()) {
    try {
      await sendOrderEmail(order, { settings, setPasswordUrl, isResend: true });
    } catch (error) {
      console.error(`[order ${order.number}] falló el reenvío de la compra:`, error);
    }
  }
}

// ─── Consultas ─────────────────────────────────────────────────────────

export async function listMine(userId: string) {
  const orders = await Order.find({ user: userId }).sort({ createdAt: -1 }).limit(200);
  return orders.map(serializeOrder);
}

export async function listByUser(userId: string) {
  return listMine(userId);
}

export async function getOrder(id: string, requester: Requester) {
  if (!isValidObjectId(id)) throw new CustomError("Pedido no encontrado", 404);
  const order = await Order.findById(id);
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (String(order.user) !== requester.userId && requester.accountType !== "admin") {
    // 404 y no 403: no se confirma a un extraño que ese pedido existe.
    throw new CustomError("Pedido no encontrado", 404);
  }
  return serializeOrder(order);
}

export async function listOrders(query: {
  status?: string;
  fulfillment?: string;
  q?: string;
  page?: number;
  limit?: number;
}) {
  const filter: Record<string, unknown> = {};

  if (query.status) {
    if (!(ORDER_STATUSES as readonly string[]).includes(query.status)) {
      throw new CustomError("Estado inválido", 400);
    }
    filter.status = query.status;
  }
  if (query.fulfillment) {
    if (!(FULFILLMENT_STATUSES as readonly string[]).includes(query.fulfillment)) {
      throw new CustomError("Estado de entrega inválido", 400);
    }
    filter.fulfillment = query.fulfillment;
  }
  if (query.q?.trim()) {
    const pattern = new RegExp(accessService.escapeRegex(query.q.trim()), "i");
    filter.$or = [
      { number: pattern },
      { email: pattern },
      { "buyer.name": pattern },
      { "buyer.documentId": pattern },
    ];
  }

  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const [items, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeOrder),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getOrderAdmin(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Pedido no encontrado", 404);
  const order = await Order.findById(id);
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return serializeOrder(order);
}

export async function updateFulfillment(id: string, fulfillment: unknown) {
  if (!(FULFILLMENT_STATUSES as readonly string[]).includes(String(fulfillment))) {
    throw new CustomError("Estado de entrega inválido", 400);
  }
  if (!isValidObjectId(id)) throw new CustomError("Pedido no encontrado", 404);

  const order = await Order.findById(id);
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (order.status !== "paid") {
    throw new CustomError("Solo se puede despachar un pedido pagado", 409);
  }
  if (!order.items.some((item) => item.productType === "physical")) {
    throw new CustomError("Este pedido no tiene productos para enviar", 400);
  }

  order.fulfillment = fulfillment as FulfillmentStatus;
  await order.save();
  return serializeOrder(order);
}
