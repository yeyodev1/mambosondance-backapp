/**
 * Pasa a los cursos que ya existen el pensum, el resumen y el precio de
 * demo-content.json. El seed de demo solo crea lo que falta; este script es el
 * que actualiza lo que ya está en la base.
 *
 * Uso:  pnpm seed:pensum            muestra lo que cambiaría, sin tocar nada
 *       pnpm seed:pensum --apply    lo aplica
 *
 * Las lecciones existentes se reutilizan en orden (cambian de título y de
 * módulo), así un video ya subido no se pierde: queda en la lección que ocupa su
 * mismo lugar. Solo se borran lecciones sobrantes que no tengan video.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Product } from "../models/product.model";
import { Module } from "../models/module.model";
import { Lesson } from "../models/lesson.model";
import { recalcCourseStats } from "../services/course-content.service";
import content from "./demo-content.json";

const apply = process.argv.includes("--apply");

function log(message: string) {
  console.log(apply ? message : `[simulación] ${message}`);
}

async function applyCourse(course: (typeof content.courses)[number]) {
  const product = await Product.findOne({ slug: course.slug, type: "course" });
  if (!product) {
    console.log(`· omitido (no existe): curso ${course.slug}`);
    return;
  }

  log(`curso ${course.slug}: precio ${product.priceCents} → ${course.priceCents}`);
  if (apply) {
    product.summary = course.summary;
    product.description = course.description;
    product.priceCents = course.priceCents;
    await product.save();
  }

  const modules = await Module.find({ product: product._id }).sort({ order: 1, createdAt: 1 });
  const moduleOrder = new Map(modules.map((mod, index) => [String(mod._id), index]));
  const lessons = (
    await Lesson.find({ product: product._id }).sort({ order: 1, createdAt: 1 })
  ).sort(
    (a, b) => (moduleOrder.get(String(a.module)) ?? 99) - (moduleOrder.get(String(b.module)) ?? 99),
  );

  const targetModules = [];
  for (const [moduleIndex, mod] of course.modules.entries()) {
    let moduleDoc = modules[moduleIndex];
    log(
      `  módulo ${moduleIndex + 1}: ${moduleDoc ? `"${moduleDoc.title}" → ` : "nuevo "}"${mod.title}"`,
    );
    if (apply) {
      if (moduleDoc) {
        moduleDoc.title = mod.title;
        moduleDoc.order = moduleIndex;
        await moduleDoc.save();
      } else {
        moduleDoc = await Module.create({
          product: product._id,
          title: mod.title,
          order: moduleIndex,
        });
      }
    }
    targetModules.push(moduleDoc);
  }

  let position = 0;
  for (const [moduleIndex, mod] of course.modules.entries()) {
    for (const [lessonIndex, title] of mod.lessons.entries()) {
      const lesson = lessons[position];
      // La primera lección es la bienvenida: la vista previa gratis del curso.
      const isFreePreview = position === 0;
      log(
        `    ${lesson ? `"${lesson.title}" → ` : "nueva "}"${title}"${isFreePreview ? " (vista previa)" : ""}`,
      );
      if (apply) {
        const fields = {
          product: product._id,
          module: targetModules[moduleIndex]!._id,
          title,
          order: lessonIndex,
          isFreePreview,
        };
        if (lesson) await Lesson.updateOne({ _id: lesson._id }, { $set: fields });
        else await Lesson.create(fields);
      }
      position += 1;
    }
  }

  const lastModule = targetModules[targetModules.length - 1];
  for (const [index, lesson] of lessons.slice(position).entries()) {
    if (lesson.bunnyVideoId) {
      // Un video subido no se borra a ciegas: queda al final para revisarlo en el panel.
      console.warn(
        `  ! "${lesson.title}" tiene video: se mueve al final de "${course.modules.at(-1)!.title}"`,
      );
      if (apply && lastModule) {
        await Lesson.updateOne(
          { _id: lesson._id },
          { $set: { module: lastModule._id, order: 100 + index, isFreePreview: false } },
        );
      }
    } else {
      log(`    borrar "${lesson.title}"`);
      if (apply) await Lesson.deleteOne({ _id: lesson._id });
    }
  }

  for (const moduleDoc of modules.slice(course.modules.length)) {
    const remaining = await Lesson.countDocuments({ module: moduleDoc._id });
    if (remaining > 0) continue;
    log(`  borrar módulo vacío "${moduleDoc.title}"`);
    if (apply) await Module.deleteOne({ _id: moduleDoc._id });
  }

  if (apply) await recalcCourseStats(product._id);
  console.log(`✔ curso ${course.slug}`);
}

async function main() {
  console.log("Conectando a MongoDB...");
  await mongoose.connect(env.DB_URI);
  for (const course of content.courses) await applyCourse(course);
  if (!apply) console.log("\nNada cambió. Corre con --apply para aplicarlo.");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló la actualización del pensum:", error);
  process.exit(1);
});
