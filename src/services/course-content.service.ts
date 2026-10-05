import mongoose, { Types } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { ILesson, Lesson } from "../models/lesson.model";
import { LessonProgress } from "../models/lessonProgress.model";
import { Module } from "../models/module.model";
import { Product } from "../models/product.model";
import * as bunnyService from "./bunny.service";

type Input = Record<string, unknown>;

function assertId(id: string, label: string) {
  if (!mongoose.isValidObjectId(id)) throw new CustomError(`${label} no encontrado`, 404);
}

function requiredTitle(value: unknown, message: string): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) throw new CustomError(message, 400);
  if (title.length > 200) throw new CustomError("El título no puede pasar de 200 caracteres", 400);
  return title;
}

function optionalBool(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new CustomError(`${label} debe ser verdadero o falso`, 400);
  return value;
}

async function findCourse(productId: string) {
  assertId(productId, "Producto");
  const product = await Product.findById(productId);
  if (!product) throw new CustomError("Producto no encontrado", 404);
  if (product.type !== "course") {
    throw new CustomError("Solo los cursos tienen módulos y lecciones", 400);
  }
  return product;
}

async function findModule(moduleId: string) {
  assertId(moduleId, "Módulo");
  const module = await Module.findById(moduleId);
  if (!module) throw new CustomError("Módulo no encontrado", 404);
  return module;
}

async function findLesson(lessonId: string) {
  assertId(lessonId, "Lección");
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new CustomError("Lección no encontrada", 404);
  return lesson;
}

/** Forma pública de una lección (sin id de video). Sirve también para documentos `lean`. */
export function serializeLesson(lesson: any): Record<string, unknown> {
  if (typeof lesson?.toJSON === "function") return lesson.toJSON();
  // `lean` trae _id; un toObject() ya lo convirtió en id. Se aceptan los dos.
  return Lesson.hydrate({ ...lesson, _id: lesson._id ?? lesson.id }).toJSON();
}

/** Forma admin: la pública más el id del video en Bunny. */
export function serializeLessonAdmin(lesson: any): Record<string, unknown> {
  return { ...serializeLesson(lesson), bunnyVideoId: String(lesson.bunnyVideoId ?? "") };
}

/**
 * lessonsCount y durationSeconds viven en el producto para que los listados no
 * tengan que contar. Solo cuentan lecciones publicadas: es lo que ve quien compra.
 */
export async function recalcCourseStats(productId: string | Types.ObjectId): Promise<void> {
  const [stats] = await Lesson.aggregate([
    { $match: { product: new Types.ObjectId(String(productId)), isPublished: true } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        previews: { $sum: { $cond: ["$isFreePreview", 1, 0] } },
        seconds: { $sum: "$durationSeconds" },
      },
    },
  ]);
  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        lessonsCount: stats?.count ?? 0,
        previewLessonsCount: stats?.previews ?? 0,
        durationSeconds: stats?.seconds ?? 0,
      },
    },
  );
}

/** Módulos del curso con sus lecciones, ordenados. */
export async function getCourseTree(
  productId: string | Types.ObjectId,
  options: { publishedOnly?: boolean; admin?: boolean } = {},
) {
  const lessonFilter: Record<string, unknown> = { product: productId };
  if (options.publishedOnly) lessonFilter.isPublished = true;

  const [modules, lessons] = await Promise.all([
    Module.find({ product: productId }).sort({ order: 1, createdAt: 1 }),
    Lesson.find(lessonFilter).sort({ order: 1, createdAt: 1 }),
  ]);

  const serialize = options.admin ? serializeLessonAdmin : serializeLesson;
  const tree = modules.map((module) => ({
    ...module.toJSON(),
    lessons: lessons
      .filter((lesson) => String(lesson.module) === String(module._id))
      .map((lesson) => serialize(lesson)),
  }));

  // Un módulo vacío no le dice nada a quien está mirando el temario.
  return options.publishedOnly ? tree.filter((module) => module.lessons.length > 0) : tree;
}

// Best-effort: un video huérfano en Bunny se limpia a mano; no vale bloquear el borrado por eso.
async function deleteBunnyVideos(videoIds: string[]) {
  const ids = videoIds.filter(Boolean);
  if (!ids.length || !bunnyService.isBunnyConfigured()) return;
  await Promise.allSettled(ids.map((id) => bunnyService.deleteVideo(id)));
}

async function deleteLessons(filter: Record<string, unknown>) {
  const lessons: ILesson[] = await Lesson.find(filter).select("_id bunnyVideoId").lean<ILesson[]>();
  if (!lessons.length) return;
  const ids = lessons.map((lesson) => lesson._id);
  await Promise.all([
    Lesson.deleteMany({ _id: { $in: ids } }),
    LessonProgress.deleteMany({ lesson: { $in: ids } }),
  ]);
  await deleteBunnyVideos(lessons.map((lesson) => lesson.bunnyVideoId));
}

/** Lo llama product.service al borrar un curso. */
export async function deleteCourseContent(productId: string | Types.ObjectId): Promise<void> {
  await deleteLessons({ product: productId });
  await Module.deleteMany({ product: productId });
  await LessonProgress.deleteMany({ product: productId });
}

// ── Módulos ──────────────────────────────────────────────────────────────

export async function createModule(productId: string, input: Input) {
  const product = await findCourse(productId);
  const title = requiredTitle(input.title, "Escribe el título del módulo");
  const last = await Module.findOne({ product: product._id }).sort({ order: -1 });
  return Module.create({ product: product._id, title, order: last ? last.order + 1 : 0 });
}

export async function updateModule(moduleId: string, input: Input) {
  const module = await findModule(moduleId);
  if (input.title !== undefined) {
    module.title = requiredTitle(input.title, "Escribe el título del módulo");
  }
  if (input.order !== undefined) {
    const order = Number(input.order);
    if (!Number.isInteger(order) || order < 0) {
      throw new CustomError("El orden debe ser un número entero", 400);
    }
    module.order = order;
  }
  await module.save();
  return module;
}

export async function deleteModule(moduleId: string): Promise<void> {
  const module = await findModule(moduleId);
  await deleteLessons({ module: module._id });
  await module.deleteOne();
  await recalcCourseStats(module.product);
}

// ── Lecciones ────────────────────────────────────────────────────────────

function applyLessonFields(lesson: any, input: Input) {
  if (input.description !== undefined) {
    if (typeof input.description !== "string") {
      throw new CustomError("La descripción debe ser texto", 400);
    }
    lesson.description = input.description.trim();
  }
  const isFreePreview = optionalBool(input.isFreePreview, "La vista previa gratis");
  if (isFreePreview !== undefined) lesson.isFreePreview = isFreePreview;
  const isPublished = optionalBool(input.isPublished, "El estado de publicación");
  if (isPublished !== undefined) lesson.isPublished = isPublished;
  if (input.durationSeconds !== undefined) {
    const seconds = Number(input.durationSeconds);
    if (!Number.isInteger(seconds) || seconds < 0) {
      throw new CustomError("La duración debe ser un número entero de segundos", 400);
    }
    lesson.durationSeconds = seconds;
  }
}

export async function createLesson(moduleId: string, input: Input) {
  const module = await findModule(moduleId);
  const title = requiredTitle(input.title, "Escribe el título de la lección");
  const last = await Lesson.findOne({ module: module._id }).sort({ order: -1 });
  const lesson = new Lesson({
    product: module.product,
    module: module._id,
    title,
    order: last ? last.order + 1 : 0,
  });
  applyLessonFields(lesson, input);
  await lesson.save();
  await recalcCourseStats(module.product);
  return serializeLessonAdmin(lesson);
}

export async function updateLesson(lessonId: string, input: Input) {
  const lesson = await findLesson(lessonId);
  if (input.title !== undefined) {
    lesson.title = requiredTitle(input.title, "Escribe el título de la lección");
  }
  applyLessonFields(lesson, input);

  // Mover de módulo solo dentro del mismo curso; va al final del módulo destino.
  if (input.module !== undefined && String(input.module) !== String(lesson.module)) {
    const target = await findModule(String(input.module));
    if (String(target.product) !== String(lesson.product)) {
      throw new CustomError("El módulo destino es de otro curso", 400);
    }
    const last = await Lesson.findOne({ module: target._id }).sort({ order: -1 });
    lesson.module = target._id;
    lesson.order = last ? last.order + 1 : 0;
  }

  await lesson.save();
  await recalcCourseStats(lesson.product);
  return serializeLessonAdmin(lesson);
}

export async function deleteLesson(lessonId: string): Promise<void> {
  const lesson = await findLesson(lessonId);
  await deleteLessons({ _id: lesson._id });
  await recalcCourseStats(lesson.product);
}

// ── Reorden ──────────────────────────────────────────────────────────────

/**
 * Recibe el árbol completo como quedó tras arrastrar: el índice es el orden.
 * Una lección puede venir dentro de otro módulo del mismo curso (se mueve).
 */
export async function reorder(productId: string, input: Input) {
  const product = await findCourse(productId);
  if (!Array.isArray(input.modules)) {
    throw new CustomError("Envía la lista de módulos con sus lecciones", 400);
  }

  const [modules, lessons] = await Promise.all([
    Module.find({ product: product._id }).select("_id").lean<{ _id: Types.ObjectId }[]>(),
    Lesson.find({ product: product._id }).select("_id").lean<{ _id: Types.ObjectId }[]>(),
  ]);
  const moduleIds = new Set(modules.map((m) => String(m._id)));
  const lessonIds = new Set(lessons.map((l) => String(l._id)));

  const moduleOps: any[] = [];
  const lessonOps: any[] = [];
  const seenModules = new Set<string>();
  const seenLessons = new Set<string>();

  input.modules.forEach((entry: any, moduleIndex: number) => {
    const moduleId = String(entry?.id ?? "");
    if (!moduleIds.has(moduleId) || seenModules.has(moduleId)) {
      throw new CustomError("Hay un módulo que no pertenece a este curso", 400);
    }
    seenModules.add(moduleId);
    moduleOps.push({
      updateOne: { filter: { _id: moduleId }, update: { $set: { order: moduleIndex } } },
    });

    const entryLessons: unknown[] = Array.isArray(entry?.lessons) ? entry.lessons : [];
    entryLessons.forEach((rawId, lessonIndex) => {
      const lessonId = String(rawId ?? "");
      if (!lessonIds.has(lessonId) || seenLessons.has(lessonId)) {
        throw new CustomError("Hay una lección que no pertenece a este curso", 400);
      }
      seenLessons.add(lessonId);
      lessonOps.push({
        updateOne: {
          filter: { _id: lessonId },
          update: { $set: { module: moduleId, order: lessonIndex } },
        },
      });
    });
  });

  if (moduleOps.length) await Module.bulkWrite(moduleOps);
  if (lessonOps.length) await Lesson.bulkWrite(lessonOps);

  return getCourseTree(product._id, { admin: true });
}

// ── Video (Bunny Stream) ─────────────────────────────────────────────────

async function ensureCollection(product: any): Promise<string | undefined> {
  if (product.bunnyCollectionId) return product.bunnyCollectionId;
  try {
    const { guid } = await bunnyService.createCollection(product.title);
    product.bunnyCollectionId = guid;
    await product.save();
    return guid;
  } catch {
    // La colección solo ordena la librería; sin ella el video se sube igual.
    return undefined;
  }
}

/** Crea el video vacío en Bunny y devuelve la firma para que el navegador suba por TUS. */
export async function startVideoUpload(lessonId: string) {
  const lesson = await findLesson(lessonId);
  if (!bunnyService.isBunnyConfigured()) {
    throw new CustomError(
      "La subida de videos aún no está habilitada (falta configurar Bunny)",
      503,
    );
  }

  const product = await Product.findById(lesson.product);
  const collectionId = product ? await ensureCollection(product) : undefined;
  const previousVideoId: string = lesson.bunnyVideoId;

  const { guid } = await bunnyService.createVideo(lesson.title, collectionId);
  lesson.bunnyVideoId = guid;
  lesson.videoStatus = "processing";
  await lesson.save();

  // Reemplazo: el video anterior ya no lo referencia nadie.
  if (previousVideoId) await deleteBunnyVideos([previousVideoId]);

  return bunnyService.tusSignature(guid);
}

/** Trae de Bunny el estado de transcodificación y la duración real. */
export async function syncVideo(lessonId: string) {
  const lesson = await findLesson(lessonId);
  if (!lesson.bunnyVideoId) throw new CustomError("Esta lección todavía no tiene video", 400);
  if (!bunnyService.isBunnyConfigured()) {
    throw new CustomError("Bunny Stream no está configurado en el servidor", 503);
  }

  const video = await bunnyService.getVideo(lesson.bunnyVideoId);
  lesson.videoStatus = bunnyService.mapBunnyStatus(video.status);
  if (video.length > 0) lesson.durationSeconds = Math.round(video.length);
  await lesson.save();
  await recalcCourseStats(lesson.product);
  return serializeLessonAdmin(lesson);
}
