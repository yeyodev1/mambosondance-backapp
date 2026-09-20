import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export interface IModule {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  title: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const moduleSchema = new Schema<IModule>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    title: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

moduleSchema.plugin(jsonPlugin);

export const Module = mongoose.models.Module || mongoose.model<IModule>("Module", moduleSchema);
