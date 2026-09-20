import mongoose, { Schema, Types } from "mongoose";
import { env } from "../config/env";
import { jsonPlugin } from "../utils/jsonPlugin";

export const VIDEO_STATUSES = ["none", "processing", "ready", "error"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface ILesson {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  module: Types.ObjectId;
  title: string;
  description: string;
  order: number;
  durationSeconds: number;
  isFreePreview: boolean;
  isPublished: boolean;
  bunnyVideoId: string;
  videoStatus: VideoStatus;
  createdAt: Date;
  updatedAt: Date;
}

const lessonSchema = new Schema<ILesson>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    module: { type: Schema.Types.ObjectId, ref: "Module", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0, min: 0 },
    isFreePreview: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: true },
    bunnyVideoId: { type: String, default: "" },
    videoStatus: { type: String, enum: VIDEO_STATUSES, default: "none" },
  },
  { timestamps: true },
);

lessonSchema.plugin(jsonPlugin);

/**
 * El id del video es la llave para pedir el embed: si viajara en el JSON público,
 * cualquiera podría armar la URL sin haber comprado. Por eso toJSON lo quita y
 * deja solo la miniatura; las rutas admin lo agregan a mano. toObject sí lo conserva.
 */
lessonSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: any) => {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.__v;
    const videoId = typeof ret.bunnyVideoId === "string" ? ret.bunnyVideoId : "";
    ret.thumbnailUrl =
      videoId && ret.videoStatus === "ready" && env.BUNNY_CDN_HOSTNAME
        ? `https://${env.BUNNY_CDN_HOSTNAME}/${videoId}/thumbnail.jpg`
        : null;
    delete ret.bunnyVideoId;
    return ret;
  },
});

export const Lesson = mongoose.models.Lesson || mongoose.model<ILesson>("Lesson", lessonSchema);
