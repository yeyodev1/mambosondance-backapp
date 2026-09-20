import { Request, Response, NextFunction } from "express";
import * as productService from "../services/product.service";

/** GET /api/admin/products?type=&q=&page= — todos, publicados o no. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.adminList(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/products/:id — con módulos y lecciones (incluye bunnyVideoId). */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.adminGet(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products — body: Product parcial; el slug sale del título si falta. */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await productService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/products/:id — solo cambia las claves enviadas. */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/products/:id — un curso arrastra su temario y sus videos. */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await productService.remove(String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
