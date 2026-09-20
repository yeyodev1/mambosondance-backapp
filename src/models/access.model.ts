import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export const ACCESS_SOURCES = ["purchase", "manual", "demo", "loyalty"] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export interface IAccess {
  user: Types.ObjectId;
  product: Types.ObjectId;
  source: AccessSource;
  order: Types.ObjectId | null;
  grantedBy: Types.ObjectId | null;
  note: string;
  // null = no se revoca nunca.
  expiresAt: Date | null;
  revokedAt: Date | null;
  // Marcas del cron de avisos para no repetir correos.
  reminder7SentAt: Date | null;
  reminder0SentAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const accessSchema = new Schema<IAccess>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    source: { type: String, enum: ACCESS_SOURCES, required: true },
    order: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    grantedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    reminder7SentAt: { type: Date, default: null },
    reminder0SentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Un solo acceso por alumno y producto: volver a otorgar actualiza el existente.
accessSchema.index({ user: 1, product: 1 }, { unique: true });
accessSchema.index({ product: 1 });
accessSchema.index({ expiresAt: 1 });

accessSchema.plugin(jsonPlugin);

export const Access =
  (mongoose.models.Access as mongoose.Model<IAccess>) ||
  mongoose.model<IAccess>("Access", accessSchema);
