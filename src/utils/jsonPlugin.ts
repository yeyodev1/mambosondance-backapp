import { Schema } from "mongoose";

/**
 * El contrato del API expone `id` (string) y nunca `_id` ni `__v`.
 * Se aplica por schema con `schema.plugin(jsonPlugin)` para que cualquier
 * `res.json(doc)` salga ya con la forma correcta, subdocumentos incluidos.
 */
export function jsonPlugin(schema: Schema) {
  const transform = (_doc: unknown, ret: Record<string, unknown>) => {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.__v;
    return ret;
  };
  schema.set("toJSON", { virtuals: true, versionKey: false, transform });
  schema.set("toObject", { virtuals: true, versionKey: false, transform });
}
