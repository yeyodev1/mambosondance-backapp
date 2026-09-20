import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export interface ILessonProgress {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  lesson: Types.ObjectId;
  product: Types.ObjectId;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const lessonProgressSchema = new Schema<ILessonProgress>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lesson: { type: Schema.Types.ObjectId, ref: "Lesson", required: true },
    // Duplicado a propósito: contar el avance de un curso sin pasar por las lecciones.
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    completedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

lessonProgressSchema.index({ user: 1, lesson: 1 }, { unique: true });
lessonProgressSchema.index({ user: 1, product: 1 });

lessonProgressSchema.plugin(jsonPlugin);

export const LessonProgress =
  mongoose.models.LessonProgress ||
  mongoose.model<ILessonProgress>("LessonProgress", lessonProgressSchema);
