import { Request, Response, NextFunction } from "express";
import * as productService from "../services/product.service";

/** GET /api/products?type=&level=&category=&featured=&page=&limit= */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listPublic(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/categories — categorías de productos físicos publicados. */
export async function categories(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listCategories());
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/:slug — incluye el temario si es curso. */
export async function getBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.getPublicBySlug(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}
