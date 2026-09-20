import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export const STAMP_SOURCES = ["attendance", "purchase", "manual"] as const;
export type StampSource = (typeof STAMP_SOURCES)[number];

export const LOYALTY_HISTORY_TYPES = ["stamp", "reward_earned", "reward_redeemed"] as const;
export type LoyaltyHistoryType = (typeof LOYALTY_HISTORY_TYPES)[number];

export interface ILoyaltyStamp {
  _id: Types.ObjectId;
  at: Date;
  note: string;
  source: StampSource;
}

export interface ILoyaltyHistory {
  at: Date;
  type: LoyaltyHistoryType;
  note: string;
}

export interface ILoyaltyCard {
  user: Types.ObjectId;
  // Solo los sellos del ciclo actual: al completar la tarjeta se vacía.
  stamps: ILoyaltyStamp[];
  rewardsAvailable: number;
  rewardsRedeemed: number;
  history: ILoyaltyHistory[];
  createdAt?: Date;
  updatedAt?: Date;
}

const stampSchema = new Schema<ILoyaltyStamp>({
  at: { type: Date, default: () => new Date() },
  note: { type: String, default: "" },
  source: { type: String, enum: STAMP_SOURCES, default: "manual" },
});

// El plugin va también en el subdocumento para que cada sello salga con `id`.
stampSchema.plugin(jsonPlugin);

const historySchema = new Schema<ILoyaltyHistory>(
  {
    at: { type: Date, default: () => new Date() },
    type: { type: String, enum: LOYALTY_HISTORY_TYPES, required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const loyaltyCardSchema = new Schema<ILoyaltyCard>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    stamps: { type: [stampSchema], default: [] },
    rewardsAvailable: { type: Number, default: 0, min: 0 },
    rewardsRedeemed: { type: Number, default: 0, min: 0 },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

loyaltyCardSchema.plugin(jsonPlugin);

export const LoyaltyCard =
  (mongoose.models.LoyaltyCard as mongoose.Model<ILoyaltyCard>) ||
  mongoose.model<ILoyaltyCard>("LoyaltyCard", loyaltyCardSchema);
