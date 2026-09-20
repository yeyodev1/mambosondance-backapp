import mongoose, { Model } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { COURSE_LEVELS, IImage, IVariant, PRODUCT_TYPES, Product } from "../models/product.model";
import { slugify } from "../utils/slugify";
import * as courseContentService from "./course-content.service";

export type Input = Record<string, unknown>;

// ── Parsers de entrada del catálogo (los reutilizan eventos, profesores y promos) ──

export function assertObjectId(id: string, message: string) {
  if (!mongoose.isValidObjectId(id)) throw new CustomError(message, 404);
}

export function parseText(value: unknown, label: string, max = 20000): string {
  if (value === null) return "";
  if (typeof value !== "string") throw new CustomError(`${label} debe ser texto`, 400);
  const text = value.trim();
  if (text.length > max) {
    throw new CustomError(`${label} no puede pasar de ${max} caracteres`, 400);
  }
  return text;
}

export function parseRequiredText(value: unknown, label: string, max = 200): string {
  const text = parseText(value ?? "", label, max);
  if (!text) throw new CustomError(`${label} es obligatorio`, 400);
  return text;
}

export function parseBool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new CustomError(`${label} debe ser verdadero o falso`, 400);
  return value;
}

export function parseInteger(value: unknown, label: string, min = 0): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min) {
    throw new CustomError(`${label} debe ser un número entero mayor o igual a ${min}`, 400);
  }
  return number;
}

export function parseNullableInteger(value: unknown, label: string, min = 0): number | null {
  if (value === null || value === "") return null;
  return parseInteger(value, label, min);
}

export function parseDate(value: unknown, label: string): Date {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new CustomError(`${label} no es una fecha válida`, 400);
  }
  return date;
}

export function parseNullableDate(value: unknown, label: string): Date | null {
  if (value === null || value === "") return null;
  return parseDate(value, label);
}

export function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CustomError(`${label} debe ser uno de: ${allowed.join(", ")}`, 400);
  }
  return value as T;
}

export function parseImage(value: unknown, label: string): IImage | null {
  if (value === null || value === "") return null;
  const image = value as Partial<IImage> | undefined;
  if (typeof image !== "object" || typeof image.url !== "string" || !image.url.trim()) {
    throw new CustomError(`${label} debe ser una imagen con url`, 400);
  }
  if (!/^https?:\/\//i.test(image.url.trim())) {
    throw new CustomError(`${label} debe tener una url válida`, 400);
  }
  return {
    url: image.url.trim(),
    publicId: typeof image.publicId === "string" ? image.publicId : "",
  };
}

export function parseGallery(value: unknown, label: string): IImage[] {
  if (!Array.isArray(value)) throw new CustomError(`${label} debe ser una lista de imágenes`, 400);
  if (value.length > 30) throw new CustomError(`${label} admite hasta 30 imágenes`, 400);
  return value.map((item) => parseImage(item, label)).filter((item): item is IImage => !!item);
}

export function parseStringList(value: unknown, label: string, maxItems = 50): string[] {
  if (!Array.isArray(value)) throw new CustomError(`${label} debe ser una lista`, 400);
  const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  if (items.length > maxItems) throw new CustomError(`${label} admite hasta ${maxItems}`, 400);
  return [...new Set(items)];
}

export function parsePagination(query: Input, defaultLimit = 20) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit)) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number) {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Para buscar texto libre sin que un "(" del usuario rompa la expresión regular. */
export function searchRegex(q: unknown): RegExp | null {
  const text = typeof q === "string" ? q.trim() : "";
  if (!text) return null;
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** Slug libre en la colección: si choca, agrega -2, -3… */
export async function uniqueSlug(
  model: Model<any>,
  source: string,
  fallback: string,
  excludeId?: unknown,
): Promise<string> {
  const base =
    slugify(source)
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback;
  let candidate = base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const filter: Record<string, unknown> = { slug: candidate };
    if (excludeId) filter._id = { $ne: excludeId };
    if (!(await model.exists(filter))) return candidate;
    candidate = `${base}-${suffix}`;
  }
  return `${base}-${Date.now()}`;
}

// ── Productos ────────────────────────────────────────────────────────────

const SORT = { order: 1, createdAt: -1 } as const;

function parseVariants(value: unknown): IVariant[] {
  if (!Array.isArray(value)) throw new CustomError("Las variantes deben ser una lista", 400);
  return value
    .map((item: any) => ({
      name: parseText(item?.name ?? "", "El nombre de la variante", 60),
      options: parseStringList(item?.options ?? [], "Las opciones de la variante"),
    }))
    .filter((variant) => variant.name && variant.options.length > 0);
}

/** Aplica al documento solo las claves que vinieron en el body (PUT parcial). */
function applyFields(product: any, input: Input) {
  if (input.title !== undefined) product.title = parseRequiredText(input.title, "El título");
  if (input.summary !== undefined) product.summary = parseText(input.summary, "El resumen", 500);
  if (input.description !== undefined) {
    product.description = parseText(input.description, "La descripción");
  }
  if (input.priceCents !== undefined) {
    product.priceCents = parseInteger(input.priceCents, "El precio (en centavos)");
  }
  if (input.compareAtCents !== undefined) {
    product.compareAtCents = parseNullableInteger(input.compareAtCents, "El precio tachado");
  }
  if (input.cover !== undefined) product.cover = parseImage(input.cover, "La portada");
  if (input.gallery !== undefined) product.gallery = parseGallery(input.gallery, "La galería");
  if (input.isPublished !== undefined) {
    product.isPublished = parseBool(input.isPublished, "El estado de publicación");
  }
  if (input.isFeatured !== undefined) {
    product.isFeatured = parseBool(input.isFeatured, "El destacado");
  }
  if (input.order !== undefined) product.order = parseInteger(input.order, "El orden");

  if (input.level !== undefined) {
    product.level =
      input.level === null || input.level === ""
        ? null
        : parseEnum(input.level, COURSE_LEVELS, "El nivel");
  }
  if (input.style !== undefined) product.style = parseText(input.style, "El estilo", 80);
  if (input.accessDurationDays !== undefined) {
    product.accessDurationDays = parseNullableInteger(
      input.accessDurationDays,
      "Los días de acceso",
      1,
    );
  }

  if (input.category !== undefined) {
    product.category = parseText(input.category, "La categoría", 80);
  }
  if (input.variants !== undefined) product.variants = parseVariants(input.variants);
  if (input.stock !== undefined) product.stock = parseNullableInteger(input.stock, "El stock");

  if (product.compareAtCents !== null && product.compareAtCents <= product.priceCents) {
    throw new CustomError("El precio tachado debe ser mayor que el precio de venta", 400);
  }
}

export async function listPublic(query: Input) {
  const { page, limit, skip } = parsePagination(query);
  const filter: Record<string, unknown> = { isPublished: true };
  if (query.type) filter.type = parseEnum(query.type, PRODUCT_TYPES, "El tipo");
  if (query.level) filter.level = parseEnum(query.level, COURSE_LEVELS, "El nivel");
  if (typeof query.category === "string" && query.category.trim()) {
    filter.category = query.category.trim();
  }
  if (query.featured === "true" || query.featured === "1") filter.isFeatured = true;

  const [items, total] = await Promise.all([
    Product.find(filter).sort(SORT).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  return paginated(items, total, page, limit);
}

export async function listCategories(): Promise<string[]> {
  const categories: string[] = await Product.distinct("category", {
    type: "physical",
    isPublished: true,
    category: { $ne: "" },
  });
  return categories.sort((a, b) => a.localeCompare(b, "es"));
}

export async function getPublicBySlug(slug: string) {
  const product = await Product.findOne({ slug: String(slug).toLowerCase(), isPublished: true });
  if (!product) throw new CustomError("Producto no encontrado", 404);
  const modules =
    product.type === "course"
      ? await courseContentService.getCourseTree(product._id, { publishedOnly: true })
      : [];
  return { ...product.toJSON(), modules };
}

export async function adminList(query: Input) {
  const { page, limit, skip } = parsePagination(query);
  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = parseEnum(query.type, PRODUCT_TYPES, "El tipo");
  const regex = searchRegex(query.q);
  if (regex) filter.$or = [{ title: regex }, { slug: regex }, { category: regex }];

  const [items, total] = await Promise.all([
    Product.find(filter).sort(SORT).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  return paginated(items, total, page, limit);
}

async function findById(id: string) {
  assertObjectId(id, "Producto no encontrado");
  const product = await Product.findById(id);
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return product;
}

export async function adminGet(id: string) {
  const product = await findById(id);
  const modules =
    product.type === "course"
      ? await courseContentService.getCourseTree(product._id, { admin: true })
      : [];
  return { ...product.toJSON(), modules };
}

export async function create(input: Input) {
  const type = parseEnum(input.type, PRODUCT_TYPES, "El tipo de producto");
  const title = parseRequiredText(input.title, "El título");
  if (input.priceCents === undefined) {
    throw new CustomError("El precio (en centavos) es obligatorio", 400);
  }

  const product = new Product({ type, title, priceCents: 0 });
  applyFields(product, input);
  const slugSource = typeof input.slug === "string" && input.slug.trim() ? input.slug : title;
  product.slug = await uniqueSlug(Product, slugSource, "producto");
  await product.save();
  return product;
}

export async function update(id: string, input: Input) {
  const product = await findById(id);
  // El tipo decide si hay temario o stock; cambiarlo dejaría datos huérfanos.
  if (input.type !== undefined && input.type !== product.type) {
    throw new CustomError("No se puede cambiar el tipo de un producto ya creado", 400);
  }
  applyFields(product, input);
  if (typeof input.slug === "string" && input.slug.trim() && input.slug !== product.slug) {
    product.slug = await uniqueSlug(Product, input.slug, "producto", product._id);
  }
  await product.save();
  return product;
}

export async function remove(id: string): Promise<void> {
  const product = await findById(id);

  if (product.type === "course") {
    // Access es de otro módulo; se consulta por nombre para no acoplar los imports.
    // Borrar un curso con alumnos adentro les rompería "Mis cursos": mejor despublicar.
    const Access = mongoose.models.Access;
    if (Access) {
      const students = await Access.countDocuments({ product: product._id, revokedAt: null });
      if (students > 0) {
        throw new CustomError(
          "Este curso tiene alumnos con acceso. Despublícalo en lugar de borrarlo.",
          409,
        );
      }
    }
    await courseContentService.deleteCourseContent(product._id);
  }

  await product.deleteOne();
}
