import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const API_BASE = "https://video.bunnycdn.com";
const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const TUS_TTL_SECONDS = 24 * 60 * 60;
const EMBED_TTL_SECONDS = 4 * 60 * 60;

export type BunnyVideoStatus = "none" | "processing" | "ready" | "error";

export function isBunnyConfigured(): boolean {
  return !!(env.BUNNY_LIBRARY_ID && env.BUNNY_STREAM_API_KEY);
}

function ensureConfig() {
  if (!isBunnyConfigured()) {
    throw new CustomError("Bunny Stream no está configurado en el servidor", 503);
  }
}

const client = axios.create({ baseURL: API_BASE, timeout: 20000 });

function headers() {
  return { AccessKey: env.BUNNY_STREAM_API_KEY, accept: "application/json" };
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Traduce el fallo de axios a un error nuestro: el mensaje crudo de Bunny no le sirve a quien administra. */
function bunnyError(error: unknown, action: string): CustomError {
  if (error instanceof CustomError) return error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 404) return new CustomError("El video no existe en Bunny", 404);
  if (status === 401 || status === 403) {
    return new CustomError("Bunny rechazó las credenciales del servidor", 503);
  }
  return new CustomError(`No se pudo ${action} en Bunny. Intenta de nuevo.`, 502);
}

export async function createVideo(title: string, collectionId?: string): Promise<{ guid: string }> {
  ensureConfig();
  try {
    const body: Record<string, string> = { title };
    if (collectionId) body.collectionId = collectionId;
    const { data } = await client.post(`/library/${env.BUNNY_LIBRARY_ID}/videos`, body, {
      headers: headers(),
    });
    return { guid: String(data.guid) };
  } catch (error) {
    throw bunnyError(error, "crear el video");
  }
}

export async function getVideo(guid: string): Promise<{ status: number; length: number }> {
  ensureConfig();
  try {
    const { data } = await client.get(`/library/${env.BUNNY_LIBRARY_ID}/videos/${guid}`, {
      headers: headers(),
    });
    return { status: Number(data.status) || 0, length: Number(data.length) || 0 };
  } catch (error) {
    throw bunnyError(error, "consultar el video");
  }
}

export async function deleteVideo(guid: string): Promise<void> {
  ensureConfig();
  try {
    await client.delete(`/library/${env.BUNNY_LIBRARY_ID}/videos/${guid}`, { headers: headers() });
  } catch (error) {
    throw bunnyError(error, "borrar el video");
  }
}

export async function createCollection(name: string): Promise<{ guid: string }> {
  ensureConfig();
  try {
    const { data } = await client.post(
      `/library/${env.BUNNY_LIBRARY_ID}/collections`,
      { name },
      { headers: headers() },
    );
    return { guid: String(data.guid) };
  } catch (error) {
    throw bunnyError(error, "crear la colección");
  }
}

/**
 * Firma para subir por TUS directo desde el navegador: el archivo nunca pasa
 * por nuestra función (Vercel corta los cuerpos grandes) y la API key no sale del servidor.
 */
export function tusSignature(videoId: string): {
  videoId: string;
  libraryId: string;
  signature: string;
  expire: number;
  endpoint: string;
} {
  ensureConfig();
  const expire = Math.floor(Date.now() / 1000) + TUS_TTL_SECONDS;
  const signature = sha256(env.BUNNY_LIBRARY_ID + env.BUNNY_STREAM_API_KEY + expire + videoId);
  return { videoId, libraryId: env.BUNNY_LIBRARY_ID, signature, expire, endpoint: TUS_ENDPOINT };
}

/** Embed firmado con vencimiento: un enlace copiado deja de servir a las 4 horas. */
export function signedEmbedUrl(videoId: string): { embedUrl: string; expiresAt: string } {
  const expires = Math.floor(Date.now() / 1000) + EMBED_TTL_SECONDS;
  const base = `https://iframe.mediadelivery.net/embed/${env.BUNNY_LIBRARY_ID}/${videoId}`;
  const expiresAt = new Date(expires * 1000).toISOString();
  if (!env.BUNNY_TOKEN_AUTH_KEY) return { embedUrl: base, expiresAt };
  const token = sha256(env.BUNNY_TOKEN_AUTH_KEY + videoId + expires);
  return { embedUrl: `${base}?token=${token}&expires=${expires}`, expiresAt };
}

export function thumbnailUrl(videoId: string): string {
  return `https://${env.BUNNY_CDN_HOSTNAME}/${videoId}/thumbnail.jpg`;
}

/** Bunny: 0 creado, 1 subido, 2 procesando, 3 transcodificando, 4 listo, 5 error, 6 falló la subida. */
export function mapBunnyStatus(status: number): BunnyVideoStatus {
  if (status === 4) return "ready";
  if (status === 5 || status === 6) return "error";
  if (status >= 1 && status <= 3) return "processing";
  return "none";
}
