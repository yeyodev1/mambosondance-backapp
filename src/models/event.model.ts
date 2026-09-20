import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";
import { IImage, imageSchema } from "./product.model";

export const EVENT_CATEGORIES = ["social", "congreso", "festival", "taller", "academia"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const SALES_MODES = ["online", "whatsapp", "instagram", "info"] as const;
export type SalesMode = (typeof SALES_MODES)[number];

export interface ITicketTier {
  _id: Types.ObjectId;
  name: string;
  priceCents: number;
  availableFrom: Date | null;
  availableUntil: Date | null;
  capacity: number | null;
  sold: number;
}

export interface IEvent {
  _id: Types.ObjectId;
  slug: string;
  title: string;
  category: EventCategory;
  summary: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  venue: string;
  city: string;
  mapUrl: string;
  cover: IImage | null;
  gallery: IImage[];
  artists: string[];
  salesMode: SalesMode;
  contactUrl: string;
  tiers: ITicketTier[];
  isPublished: boolean;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Con _id propio: la orden y la entrada guardan el tierId para saber qué se vendió.
const tierSchema = new Schema<ITicketTier>({
  name: { type: String, required: true, trim: true },
  priceCents: { type: Number, required: true, min: 0 },
  availableFrom: { type: Date, default: null },
  availableUntil: { type: Date, default: null },
  capacity: { type: Number, default: null },
  sold: { type: Number, default: 0, min: 0 },
});

tierSchema.plugin(jsonPlugin);

const eventSchema = new Schema<IEvent>(
  {
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: EVENT_CATEGORIES, required: true, index: true },
    summary: { type: String, default: "" },
    description: { type: String, default: "" },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, default: null },
    venue: { type: String, default: "" },
    city: { type: String, default: "" },
    mapUrl: { type: String, default: "" },
    cover: { type: imageSchema, default: null },
    gallery: { type: [imageSchema], default: [] },
    artists: { type: [String], default: [] },
    salesMode: { type: String, enum: SALES_MODES, default: "info" },
    contactUrl: { type: String, default: "" },
    tiers: { type: [tierSchema], default: [] },
    isPublished: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true },
);

eventSchema.plugin(jsonPlugin);

export const Event = mongoose.models.Event || mongoose.model<IEvent>("Event", eventSchema);
