import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Access } from "../models/access.model";
import { Lesson } from "../models/lesson.model";
import { LessonProgress } from "../models/lessonProgress.model";
import { Product } from "../models/product.model";
import * as accessService from "./access.service";
import * as bunnyService from "./bunny.service";
import { getCourseTree } from "./course-content.service";
import * as ticketService from "./ticket.service";

interface Requester {
  userId: string;
  accountType: string;
}

/**
 * Cursos del alumno. Los vencidos siguen apareciendo (bloqueados, con opción de
 * renovar): que un curso se esfume sin explicación genera tickets de soporte.
 * Los revocados no: ahí hubo una decisión del equipo.
 */
export async function myCourses(userId: string) {
  const accesses: any[] = await Access.find({ user: userId, revokedAt: null })
    .populate("product")
    .sort({ createdAt: -1 });
  const valid = accesses.filter(
    (access) => access.product?._id && access.product.type === "course",
  );
  if (!valid.length) return [];

  const productIds = valid.map((access) => access.product._id);

  // El avance se mide contra lo que el alumno ve hoy: lecciones publicadas.
  const lessons: any[] = await Lesson.find({ product: { $in: productIds }, isPublished: true })
    .select("_id product")
    .lean();
  const totals = new Map<string, number>();
  for (const lesson of lessons) {
    const key = String(lesson.product);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }

  const done: any[] = await LessonProgress.find({
    user: userId,
    lesson: { $in: lessons.map((lesson) => lesson._id) },
  })
    .select("product")
    .lean();
  const completed = new Map<string, number>();
  for (const progress of done) {
    const key = String(progress.product);
    completed.set(key, (completed.get(key) ?? 0) + 1);
  }

  return valid.map((access) => {
    const key = String(access.product._id);
    return {
      product: access.product.toJSON(),
      access: { expiresAt: access.expiresAt, status: accessService.accessStatus(access) },
      progress: { completed: completed.get(key) ?? 0, total: totals.get(key) ?? 0 },
    };
  });
}

export async function myCourse(requester: Requester, slug: string) {
  const product: any = await Product.findOne({
    slug: String(slug || "").toLowerCase(),
    type: "course",
  });
  if (!product) throw new CustomError("Curso no encontrado", 404);

  const isAdmin = requester.accountType === "admin";
  const access = await Access.findOne({ user: requester.userId, product: product._id });
  if ((!access || access.revokedAt) && !isAdmin) {
    throw new CustomError("No tienes acceso a este curso", 403);
  }

  // Con el acceso vencido igual se devuelve el temario: el frontend lo muestra
  // bloqueado. Los videos están protegidos aparte, en el playback.
  const [modules, done] = await Promise.all([
    getCourseTree(product._id, { publishedOnly: true }),
    LessonProgress.find({ user: requester.userId, product: product._id }).select("lesson").lean(),
  ]);
  const completedIds = new Set((done as any[]).map((progress) => String(progress.lesson)));

  return {
    ...product.toJSON(),
    modules: modules.map((module: any) => ({
      ...module,
      lessons: module.lessons.map((lesson: any) => ({
        ...lesson,
        completed: completedIds.has(String(lesson.id)),
      })),
    })),
    access:
      access && !access.revokedAt
        ? { expiresAt: access.expiresAt, status: accessService.accessStatus(access) }
        : { expiresAt: null, status: "vigente" as const },
  };
}

export async function myTickets(userId: string) {
  return ticketService.listMine(userId);
}

// ─── Lecciones ─────────────────────────────────────────────────────────

async function findLesson(id: string, isAdmin: boolean) {
  if (!isValidObjectId(id)) throw new CustomError("Clase no encontrada", 404);
  const lesson: any = await Lesson.findById(id);
  // Una lección en borrador no existe para el alumno.
  if (!lesson || (!lesson.isPublished && !isAdmin)) {
    throw new CustomError("Clase no encontrada", 404);
  }
  return lesson;
}

/** `requester` es opcional: las lecciones de muestra se ven sin sesión. */
export async function getPlayback(lessonId: string, requester?: Requester) {
  const isAdmin = requester?.accountType === "admin";
  const lesson = await findLesson(lessonId, isAdmin);

  if (!lesson.isFreePreview && !isAdmin) {
    if (!requester) throw new CustomError("Inicia sesión para ver esta clase", 401);
    if (!(await accessService.hasActiveAccess(requester.userId, lesson.product))) {
      throw new CustomError("No tienes acceso vigente a este curso", 403);
    }
  }

  if (!lesson.bunnyVideoId || lesson.videoStatus !== "ready") {
    throw new CustomError("Esta clase todavía no tiene video disponible", 404);
  }
  if (!bunnyService.isBunnyConfigured()) {
    throw new CustomError("El reproductor de video no está configurado en el servidor", 503);
  }

  return bunnyService.signedEmbedUrl(lesson.bunnyVideoId);
}

export async function setLessonCompleted(
  requester: Requester,
  lessonId: string,
  completed: boolean,
) {
  const isAdmin = requester.accountType === "admin";
  const lesson = await findLesson(lessonId, isAdmin);

  if (!isAdmin && !(await accessService.hasActiveAccess(requester.userId, lesson.product))) {
    throw new CustomError("No tienes acceso vigente a este curso", 403);
  }

  if (completed) {
    // Upsert sobre el índice único user+lesson: marcar dos veces no duplica ni cambia la fecha.
    await LessonProgress.updateOne(
      { user: requester.userId, lesson: lesson._id },
      { $setOnInsert: { product: lesson.product, completedAt: new Date() } },
      { upsert: true },
    );
  } else {
    await LessonProgress.deleteOne({ user: requester.userId, lesson: lesson._id });
  }
}
