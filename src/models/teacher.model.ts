import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";
import { IImage, imageSchema } from "./product.model";

export interface ITeacher {
  _id: Types.ObjectId;
  name: string;
  role: string;
  bio: string;
  photo: IImage | null;
  instagram: string;
  order: number;
  isFounder: boolean;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const teacherSchema = new Schema<ITeacher>(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "" },
    bio: { type: String, default: "" },
    photo: { type: imageSchema, default: null },
    instagram: { type: String, default: "" },
    order: { type: Number, default: 0 },
    isFounder: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true },
);

teacherSchema.plugin(jsonPlugin);

export const Teacher =
  mongoose.models.Teacher || mongoose.model<ITeacher>("Teacher", teacherSchema);
