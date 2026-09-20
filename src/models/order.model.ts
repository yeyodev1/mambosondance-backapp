import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export const ORDER_STATUSES = ["pending", "paid", "canceled", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_STATUSES = ["none", "pending", "shipped", "delivered"] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export interface IOrderItem {
  kind: "product" | "ticket";
  product: Types.ObjectId | null;
  event: Types.ObjectId | null;
  tierId: string | null;
  title: string;
  unitCents: number;
  quantity: number;
  selectedOptions: Record<string, string>;
  image: string | null;
  // Foto del tipo de producto al comprar: decide accesos, stock y envío aunque
  // el producto cambie o se borre después.
  productType: "course" | "physical" | null;
}

export interface IShipping {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
}

export interface IBuyer {
  name: string;
  phone: string;
  documentId: string;
}

export interface IOrder {
  number: string;
  user: Types.ObjectId;
  email: string;
  items: IOrderItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  status: OrderStatus;
  fulfillment: FulfillmentStatus;
  shipping: IShipping | null;
  buyer: IBuyer;
  clientTransactionId: string;
  payphoneId: string | null;
  payphoneResponse: unknown;
  paidAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    kind: { type: String, enum: ["product", "ticket"], required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    event: { type: Schema.Types.ObjectId, ref: "Event", default: null },
    tierId: { type: String, default: null },
    title: { type: String, required: true },
    unitCents: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    selectedOptions: { type: Schema.Types.Mixed, default: {} },
    image: { type: String, default: null },
    productType: { type: String, enum: ["course", "physical", null], default: null },
  },
  // minimize: false — sin esto Mongoose borra el `{}` de selectedOptions y el
  // contrato promete siempre un objeto.
  { _id: false, minimize: false },
);

const shippingSchema = new Schema<IShipping>(
  {
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    city: { type: String, default: "" },
    address: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

const buyerSchema = new Schema<IBuyer>(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    documentId: { type: String, default: "" },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    number: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    items: { type: [orderItemSchema], default: [] },
    subtotalCents: { type: Number, required: true, min: 0 },
    discountCents: { type: Number, default: 0, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    fulfillment: { type: String, enum: FULFILLMENT_STATUSES, default: "none", index: true },
    shipping: { type: shippingSchema, default: null },
    buyer: { type: buyerSchema, default: () => ({}) },
    clientTransactionId: { type: String, required: true, unique: true },
    payphoneId: { type: String, default: null },
    // Respuesta completa de Payphone para soporte y conciliación. select: false
    // para que no viaje al navegador en ningún listado.
    payphoneResponse: { type: Schema.Types.Mixed, default: null, select: false },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });

orderSchema.plugin(jsonPlugin);

export const Order =
  (mongoose.models.Order as mongoose.Model<IOrder>) || mongoose.model<IOrder>("Order", orderSchema);
