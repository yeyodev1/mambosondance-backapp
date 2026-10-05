import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export const PRODUCT_TYPES = ["course", "physical"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const COURSE_LEVELS = ["principiante", "intermedio", "avanzado", "todos"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export interface IImage {
  url: string;
  publicId: string;
}

export interface IVariant {
  name: string;
  options: string[];
}

export interface IProduct {
  _id: Types.ObjectId;
  type: ProductType;
  slug: string;
  title: string;
  summary: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  cover: IImage | null;
  gallery: IImage[];
  isPublished: boolean;
  isFeatured: boolean;
  order: number;
  level: CourseLevel | null;
  style: string;
  accessDurationDays: number | null;
  lessonsCount: number;
  previewLessonsCount: number;
  durationSeconds: number;
  category: string;
  variants: IVariant[];
  stock: number | null;
  bunnyCollectionId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Subdocumento reutilizado por eventos, profesores y promos. Sin _id: el contrato es { url, publicId }. */
export const imageSchema = new Schema<IImage>(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

const variantSchema = new Schema<IVariant>(
  {
    name: { type: String, required: true, trim: true },
    options: { type: [String], default: [] },
  },
  { _id: false },
);

const productSchema = new Schema<IProduct>(
  {
    type: { type: String, enum: PRODUCT_TYPES, required: true, index: true },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: "" },
    description: { type: String, default: "" },
    priceCents: { type: Number, required: true, min: 0 },
    compareAtCents: { type: Number, default: null },
    cover: { type: imageSchema, default: null },
    gallery: { type: [imageSchema], default: [] },
    isPublished: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    level: { type: String, enum: [...COURSE_LEVELS, null], default: null },
    style: { type: String, default: "" },
    accessDurationDays: { type: Number, default: null },
    // Persistidos para no contar lecciones en cada listado; los recalcula course-content.service.
    lessonsCount: { type: Number, default: 0 },
    // Las de vista previa (la bienvenida) se anuncian aparte de las clases del pensum.
    previewLessonsCount: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    category: { type: String, default: "", trim: true },
    variants: { type: [variantSchema], default: [] },
    stock: { type: Number, default: null },
    // Colección de Bunny donde viven los videos del curso. Dato interno.
    bunnyCollectionId: { type: String, default: "" },
  },
  { timestamps: true },
);

productSchema.plugin(jsonPlugin);

// Encima del plugin: mismo resultado pero sin el dato interno de Bunny.
productSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc: unknown, ret: any) => {
    if (ret._id !== undefined) {
      ret.id = String(ret._id);
      delete ret._id;
    }
    delete ret.__v;
    delete ret.bunnyCollectionId;
    return ret;
  },
});

export const Product =
  mongoose.models.Product || mongoose.model<IProduct>("Product", productSchema);
