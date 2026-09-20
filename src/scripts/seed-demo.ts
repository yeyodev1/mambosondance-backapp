/**
 * Seed de DEMOSTRACIÓN — carga el contenido de demo-content.json para poder
 * revisar la plataforma antes de que el cliente entregue su catálogo real.
 *
 * Uso:  pnpm seed:demo            crea lo que falte (idempotente, busca por slug)
 *       pnpm seed:demo --clean    borra solo lo que este seed creó
 *
 * Precios, descripciones y temarios son provisionales. Las imágenes usan rutas
 * relativas (/img/...) servidas por el frontapp: así funcionan igual en local,
 * en preview y en producción mientras Cloudinary no esté configurado.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Product } from "../models/product.model";
import { Module } from "../models/module.model";
import { Lesson } from "../models/lesson.model";
import { Event } from "../models/event.model";
import { recalcCourseStats } from "../services/course-content.service";
import content from "./demo-content.json";

const UPCOMING_SLUG = "social-de-prueba-demo";

function image(url: string) {
  return { url, publicId: "" };
}

async function seedCourses() {
  for (const [index, course] of content.courses.entries()) {
    if (await Product.exists({ slug: course.slug })) {
      console.log(`· omitido (ya existe): curso ${course.slug}`);
      continue;
    }

    const product = await Product.create({
      type: "course",
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      description: course.description,
      priceCents: course.priceCents,
      cover: image(course.image),
      level: course.level,
      style: course.style,
      accessDurationDays: null,
      isFeatured: course.isFeatured,
      isPublished: true,
      order: index,
    });

    for (const [moduleIndex, mod] of course.modules.entries()) {
      const moduleDoc = await Module.create({
        product: product._id,
        title: mod.title,
        order: moduleIndex,
      });
      for (const [lessonIndex, title] of mod.lessons.entries()) {
        // Sin video: la lección aparece como "Próximamente" hasta subirlo desde el panel.
        await Lesson.create({
          product: product._id,
          module: moduleDoc._id,
          title,
          order: lessonIndex,
          isFreePreview: moduleIndex === 0 && lessonIndex === 0,
        });
      }
    }

    await recalcCourseStats(product._id);
    console.log(`✔ curso ${course.slug}`);
  }
}

async function seedMerch() {
  for (const [index, item] of content.merch.entries()) {
    if (await Product.exists({ slug: item.slug })) {
      console.log(`· omitido (ya existe): merch ${item.slug}`);
      continue;
    }
    await Product.create({
      type: "physical",
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      priceCents: item.priceCents,
      cover: image(item.image),
      gallery: item.gallery.map(image),
      category: item.category,
      variants: item.variants,
      isFeatured: item.isFeatured,
      isPublished: true,
      order: index,
    });
    console.log(`✔ merch ${item.slug}`);
  }
}

async function seedEvents() {
  for (const event of content.events) {
    if (await Event.exists({ slug: event.slug })) {
      console.log(`· omitido (ya existe): evento ${event.slug}`);
      continue;
    }
    await Event.create({
      ...event,
      startsAt: new Date(event.startsAt),
      cover: image(event.image),
      isPublished: true,
    });
    console.log(`✔ evento ${event.slug}`);
  }

  // Un evento futuro para poder probar la compra de entradas de punta a punta.
  if (!(await Event.exists({ slug: UPCOMING_SLUG }))) {
    const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    startsAt.setHours(21, 0, 0, 0);
    await Event.create({
      slug: UPCOMING_SLUG,
      title: "Social de prueba (demo)",
      category: "social",
      summary: "Evento de demostración para probar la venta de entradas.",
      description:
        "Este evento existe solo para revisar el flujo de entradas. Bórralo desde el panel.",
      startsAt,
      venue: "Por confirmar",
      city: "",
      cover: image("/img/foto-2.jpg"),
      salesMode: "online",
      tiers: [
        { name: "Preventa", priceCents: 1000, capacity: 50 },
        { name: "General", priceCents: 1500, capacity: 100 },
      ],
      isFeatured: true,
      isPublished: true,
    });
    console.log(`✔ evento ${UPCOMING_SLUG}`);
  }
}

async function clean() {
  const productSlugs = [...content.courses, ...content.merch].map((item) => item.slug);
  const products = await Product.find({ slug: { $in: productSlugs } }).select("_id");
  const ids = products.map((product) => product._id);
  await Lesson.deleteMany({ product: { $in: ids } });
  await Module.deleteMany({ product: { $in: ids } });
  await Product.deleteMany({ _id: { $in: ids } });
  const eventSlugs = [...content.events.map((event) => event.slug), UPCOMING_SLUG];
  await Event.deleteMany({ slug: { $in: eventSlugs } });
  console.log(`✔ demo eliminada: ${ids.length} productos y sus eventos`);
}

async function main() {
  console.log("Conectando a MongoDB...");
  await mongoose.connect(env.DB_URI);

  if (process.argv.includes("--clean")) {
    await clean();
  } else {
    await seedCourses();
    await seedMerch();
    await seedEvents();
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló el seed de demo:", error);
  process.exit(1);
});
