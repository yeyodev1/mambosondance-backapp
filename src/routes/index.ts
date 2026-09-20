import express, { Application } from "express";
import authRoutes from "./auth.routes";
import healthRoutes from "./health.routes";
import cronRoutes from "./cron.routes";
import productRoutes from "./product.routes";
import eventRoutes from "./event.routes";
import teacherRoutes from "./teacher.routes";
import promoRoutes from "./promo.routes";
import settingsRoutes from "./settings.routes";
import contactRoutes from "./contact.routes";
import orderRoutes from "./order.routes";
import lessonRoutes from "./lesson.routes";
import meRoutes from "./me.routes";
import adminRoutes from "./admin.routes";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/health", healthRoutes);
  router.use("/auth", authRoutes);
  router.use("/cron", cronRoutes);

  router.use("/products", productRoutes);
  router.use("/events", eventRoutes);
  router.use("/teachers", teacherRoutes);
  router.use("/promos", promoRoutes);
  router.use("/settings", settingsRoutes);
  router.use("/contact", contactRoutes);

  router.use("/orders", orderRoutes);
  router.use("/lessons", lessonRoutes);
  router.use("/me", meRoutes);
  router.use("/admin", adminRoutes);
}

export default routerApi;
