import mongoose, { Schema } from "mongoose";

export interface IResendLog {
  email: string;
  createdAt: Date;
}

/**
 * Un documento por cada reenvío de "Encontrar mi compra". Vive en Mongo y no en
 * memoria porque en Vercel cada petición puede caer en una instancia distinta.
 */
const resendLogSchema = new Schema<IResendLog>({
  email: { type: String, required: true, lowercase: true, trim: true },
  createdAt: { type: Date, default: () => new Date() },
});

resendLogSchema.index({ email: 1, createdAt: -1 });
// Mongo los borra solo. El margen sobre la ventana de 15 minutos es porque el
// limpiador TTL corre cada minuto y no es exacto; la ventana real la aplica la consulta.
resendLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 });

export const ResendLog =
  (mongoose.models.ResendLog as mongoose.Model<IResendLog>) ||
  mongoose.model<IResendLog>("ResendLog", resendLogSchema);
