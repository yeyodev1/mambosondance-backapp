import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export const SETTINGS_KEY = "main";

export interface ISettings {
  _id: Types.ObjectId;
  key: string;
  loyaltyEnabled: boolean;
  loyaltyStampsRequired: number;
  loyaltyRewardText: string;
  loyaltyStampOnPurchase: boolean;
  whatsapp: string;
  instagram: string;
  shippingNote: string;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    // Índice único sobre una clave fija: dos cold starts a la vez no pueden crear dos singletons.
    key: { type: String, default: SETTINGS_KEY, unique: true },
    loyaltyEnabled: { type: Boolean, default: true },
    loyaltyStampsRequired: { type: Number, default: 10, min: 1 },
    loyaltyRewardText: { type: String, default: "Una clase gratis" },
    loyaltyStampOnPurchase: { type: Boolean, default: false },
    whatsapp: { type: String, default: "" },
    instagram: { type: String, default: "" },
    shippingNote: {
      type: String,
      default: "Coordinamos la entrega por WhatsApp después de tu compra.",
    },
  },
  { timestamps: true },
);

settingsSchema.plugin(jsonPlugin);

export const Settings =
  mongoose.models.Settings || mongoose.model<ISettings>("Settings", settingsSchema);
