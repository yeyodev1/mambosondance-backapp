import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";
import { IImage, imageSchema } from "./product.model";

export interface IPromo {
  _id: Types.ObjectId;
  title: string;
  text: string;
  image: IImage | null;
  ctaLabel: string;
  ctaUrl: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const promoSchema = new Schema<IPromo>(
  {
    title: { type: String, required: true, trim: true },
    text: { type: String, default: "" },
    image: { type: imageSchema, default: null },
    ctaLabel: { type: String, default: "" },
    ctaUrl: { type: String, default: "" },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

promoSchema.plugin(jsonPlugin);

export const Promo = mongoose.models.Promo || mongoose.model<IPromo>("Promo", promoSchema);
