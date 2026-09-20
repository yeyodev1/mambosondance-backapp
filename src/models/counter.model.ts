import mongoose, { Schema } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export interface ICounter {
  key: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

counterSchema.plugin(jsonPlugin);

export const Counter =
  (mongoose.models.Counter as mongoose.Model<ICounter>) ||
  mongoose.model<ICounter>("Counter", counterSchema);

/**
 * Siguiente número de una secuencia. El `$inc` con upsert es atómico en Mongo:
 * dos órdenes creadas al mismo tiempo nunca reciben el mismo número, cosa que
 * un `countDocuments() + 1` no garantiza.
 */
export async function nextSequence(key: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return counter.seq;
}
