/**
 * Seed script — crea (o actualiza) la cuenta de alumno demo desde .env y le da
 * acceso sin vencimiento a todos los cursos. Sirve para ver la plataforma
 * "como alumno". Es idempotente: se vuelve a correr después de cargar
 * contenido para cubrir los cursos nuevos.
 * Uso: pnpm seed:student
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Access } from "../models/access.model";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";

async function main() {
  if (!env.DEMO_STUDENT_EMAIL || !env.DEMO_STUDENT_PASSWORD) {
    console.error("✖ DEMO_STUDENT_EMAIL y DEMO_STUDENT_PASSWORD deben estar definidas en .env");
    process.exit(1);
  }

  console.log("Conectando a MongoDB...");
  await mongoose.connect(env.DB_URI);

  let student = await User.findOne({ email: env.DEMO_STUDENT_EMAIL }).select("+password");

  if (student) {
    // Nunca degradar una cuenta de administración por un correo mal puesto en .env.
    if (student.accountType === "admin") {
      console.error(
        `✖ ${env.DEMO_STUDENT_EMAIL} es una cuenta admin; usa otro correo para el demo`,
      );
      await mongoose.disconnect();
      process.exit(1);
    }
    student.password = env.DEMO_STUDENT_PASSWORD;
    student.isActive = true;
    if (!student.name) student.name = "Alumno demo";
    await student.save();
    console.log(`✔ Alumno demo actualizado: ${env.DEMO_STUDENT_EMAIL}`);
  } else {
    student = await User.create({
      email: env.DEMO_STUDENT_EMAIL,
      password: env.DEMO_STUDENT_PASSWORD,
      name: "Alumno demo",
      accountType: "customer",
    });
    console.log(`✔ Alumno demo creado: ${env.DEMO_STUDENT_EMAIL}`);
  }

  const courses = await Product.find({ type: "course" }).select("_id title");
  for (const course of courses) {
    // Upsert sobre el índice único user+product; reactiva el acceso si alguien lo revocó.
    await Access.updateOne(
      { user: student._id, product: course._id },
      {
        $set: {
          source: "demo",
          expiresAt: null,
          revokedAt: null,
          note: "Cuenta demo",
          reminder7SentAt: null,
          reminder0SentAt: null,
        },
      },
      { upsert: true },
    );
    console.log(`  · acceso demo: ${course.title}`);
  }
  console.log(`✔ ${courses.length} curso(s) con acceso demo sin vencimiento`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló el seed:", error);
  process.exit(1);
});
