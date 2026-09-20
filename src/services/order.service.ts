import crypto from "crypto";
import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
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
import { User } from "../models/user.model";
import * as accessService from "./access.service";
import * as emailService from "./email.service";
import * as loyaltyService from "./loyalty.service";
import * as payphoneService from "./payphone.service";
import { getSettings } from "./settings.service";
import * as ticketService from "./ticket.service";

const MAX_LINES = 20;
const MAX_PHYSICAL_QUANTITY = 20;
const MAX_TICKET_QUANTITY = 10;

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

function parseBuyer(input: any) {
  const buyer = {
    name: text(input?.name, 120),
    phone: text(input?.phone, 30),
    documentId: text(input?.documentId, 20).replace(/\s+/g, ""),
  };
  if (!buyer.name) throw new CustomError("Escribe el nombre de quien compra", 400);
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
 */
async function buildItems(userId: string, rawItems: unknown): Promise<IOrderItem[]> {
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
        if (await accessService.hasActiveAccess(userId, product._id)) {
          throw new CustomError(`Ya tienes acceso vigente a ${product.title}`, 409);
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

export async function createOrder(userId: string, body: any) {
  if (!payphoneService.isPayphoneConfigured()) {
    throw new CustomError("Los pagos en línea aún no están habilitados", 503);
  }

  const user: any = await User.findById(userId);
  if (!user || !user.isActive) throw new CustomError("No autorizado", 401);

  const buyer = parseBuyer(body?.buyer);
  const items = await buildItems(userId, body?.items);

  const hasPhysical = items.some((item) => item.productType === "physical");
  const shipping = hasPhysical ? parseShipping(body?.shipping) : null;

  const subtotalCents = items.reduce((sum, item) => sum + item.unitCents * item.quantity, 0);
  const discountCents = 0;
  const totalCents = subtotalCents - discountCents;
  if (totalCents <= 0) {
    throw new CustomError("El total del pedido debe ser mayor a cero", 400);
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

  const courseTitles: string[] = [];
  const ticketsForEmail: emailService.OrderPaidEmail["tickets"] = [];
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
        courseTitles.push(item.title);
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
        const tickets = await ticketService.issueTickets({
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
        for (const ticket of tickets) {
          ticketsForEmail.push({
            code: ticket.code,
            eventTitle: event?.title ?? item.title,
            tierName: ticket.tierName,
            startsAt: event?.startsAt ?? null,
          });
        }
        // Un taller cuenta para la tarjeta igual que un curso; una fiesta no.
        if (event?.category === "taller") stamps += 1;
      }
    } catch (error) {
      console.error(`${tag} falló la entrega de "${item.title}":`, error);
    }
  }

  // El correo de compra va antes que el de sello para que lleguen en orden lógico.
  try {
    const buyer: any = await User.findById(order.user).select("name");
    await emailService.sendOrderPaid(order.email, {
      name: order.buyer?.name || buyer?.name,
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
      tickets: ticketsForEmail,
      courseTitles,
      hasPhysical: order.items.some((item: IOrderItem) => item.productType === "physical"),
      shippingNote: settings?.shippingNote,
    });
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

/**
 * Idempotente: la página de respuesta se recarga más de lo que uno cree, y una
 * orden ya pagada responde lo mismo sin duplicar accesos, entradas ni correos.
 */
export async function confirmOrder(
  requester: Requester,
  input: { id: unknown; clientTransactionId: unknown },
): Promise<{ order: Record<string, unknown>; status: ConfirmStatus }> {
  const clientTransactionId = text(input.clientTransactionId, 60);
  const payphoneId = text(input.id, 30);
  if (!clientTransactionId || !/^\d+$/.test(payphoneId)) {
    throw new CustomError("Faltan los datos de la transacción", 400);
  }

  const order = await Order.findOne({ clientTransactionId });
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (String(order.user) !== requester.userId && requester.accountType !== "admin") {
    throw new CustomError("Este pedido no es tuyo", 403);
  }

  if (order.status === "paid") return { order: serializeOrder(order), status: "paid" };
  if (order.status === "canceled") return { order: serializeOrder(order), status: "canceled" };

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
      return { order: serializeOrder(failed ?? order), status: "failed" };
    }

    const hasPhysical = order.items.some((item) => item.productType === "physical");
    const paid = await Order.findOneAndUpdate(
      open,
      {
        $set: {
          ...record,
          status: "paid",
          paidAt: new Date(),
          fulfillment: hasPhysical ? "pending" : "none",
        },
      },
      { new: true },
    );

    // null = otra petición ganó la carrera y ya está entregando; no se repite.
    if (paid) {
      await fulfillOrder(paid);
      return { order: serializeOrder(paid), status: "paid" };
    }
    const current = await Order.findById(order._id);
    return {
      order: serializeOrder(current ?? order),
      status: (current?.status === "paid" ? "paid" : "failed") as ConfirmStatus,
    };
  }

  const status: ConfirmStatus =
    data.statusCode === payphoneService.PAYPHONE_CANCELED && belongsToOrder ? "canceled" : "failed";
  const updated = await Order.findOneAndUpdate(
    open,
    { $set: { ...record, status } },
    { new: true },
  );
  if (updated) return { order: serializeOrder(updated), status };

  const current = await Order.findById(order._id);
  return {
    order: serializeOrder(current ?? order),
    status: current?.status === "paid" ? "paid" : status,
  };
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
