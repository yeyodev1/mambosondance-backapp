import { Resend } from "resend";
import { env } from "../config/env";

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

/**
 * Envía un correo. Nunca lanza: el fallo de un correo no debe romper el
 * flujo que lo disparó (una compra, un registro). Devuelve si Resend lo aceptó.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY no definida — no se envió "${subject}" a ${to}`);
    return false;
  }

  try {
    const { error } = await client.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html });
    if (error) {
      console.error("[email] Resend rechazó el envío:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

const BRAND = {
  red: "#CD1719",
  wine: "#460B00",
  background: "#fdfcfa",
  text: "#191423",
  muted: "#6b6473",
  border: "#eee7df",
};

/**
 * Plantilla base con la marca. El logo es SVG y los clientes de correo no lo
 * muestran, por eso el encabezado lleva el nombre en texto.
 */
export function layout(title: string, body: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${BRAND.background};padding:32px 12px;font-family:Arial,Helvetica,sans-serif">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden">
        <tr><td style="background:${BRAND.red};color:#ffffff;padding:22px 32px;font-size:22px;font-weight:bold;letter-spacing:0.3px">MamboSon</td></tr>
        <tr><td style="padding:32px;color:${BRAND.text};font-size:15px;line-height:1.65">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${BRAND.text}">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.5">
          MamboSon · Academia de salsa · Vibrando sin prisa, dibujando cada paso
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

// ─── Piezas de la plantilla ────────────────────────────────────────────

/** Todo dato que venga de un formulario pasa por acá antes de entrar al HTML. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function button(label: string, url: string): string {
  return `<p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;background:${BRAND.red};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 28px;border-radius:999px">${esc(label)}</a></p>`;
}

function p(html: string): string {
  return `<p style="margin:0 0 14px">${html}</p>`;
}

function small(html: string): string {
  return `<p style="margin:0 0 14px;color:${BRAND.muted};font-size:13px">${html}</p>`;
}

function greeting(name?: string): string {
  const first = (name || "").trim().split(/\s+/)[0];
  return p(first ? `Hola, ${esc(first)}:` : "Hola:");
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "30 de noviembre de 2026", siempre en hora de Ecuador. */
export function formatLongDate(date: Date | string): string {
  return new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Guayaquil",
  }).format(new Date(date));
}

function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Guayaquil",
  }).format(new Date(date));
}

function accessSentence(expiresAt: Date | string | null): string {
  return expiresAt
    ? `Tu acceso está activo hasta el ${formatLongDate(expiresAt)}.`
    : "Tu acceso no tiene fecha de vencimiento.";
}

// Rutas del frontapp a las que apuntan los botones.
const links = {
  home: () => env.FRONTEND_URL,
  account: () => `${env.FRONTEND_URL}/cuenta`,
  course: (slug?: string) =>
    slug ? `${env.FRONTEND_URL}/mis-clases/${slug}` : `${env.FRONTEND_URL}/cuenta`,
};

// ─── Correos ───────────────────────────────────────────────────────────

export async function sendWelcome(to: string, name?: string): Promise<boolean> {
  const body = [
    greeting(name),
    p("Qué alegría tenerte en MamboSon. Tu cuenta ya está lista."),
    p(
      "Desde ella puedes tomar las clases online a tu ritmo, comprar tus entradas para los eventos y llevar tu tarjeta de fidelidad.",
    ),
    button("Entrar a mi cuenta", links.account()),
    small("Si tienes alguna duda, responde este correo y te ayudamos."),
  ].join("");
  return sendEmail(to, "Te damos la bienvenida a MamboSon", layout("Bienvenido a MamboSon", body));
}

export async function sendPasswordReset(to: string, name: string, url: string): Promise<boolean> {
  const body = [
    greeting(name),
    p("Recibimos un pedido para cambiar la contraseña de tu cuenta."),
    button("Crear una nueva contraseña", url),
    small(
      "El enlace funciona durante una hora. Si no lo pediste tú, ignora este correo: tu contraseña sigue igual.",
    ),
  ].join("");
  return sendEmail(to, "Restablece tu contraseña", layout("Restablece tu contraseña", body));
}

/** Cuenta creada por el equipo (acceso manual, sello): el alumno define su contraseña. */
export async function sendAccountCreated(
  to: string,
  name: string,
  setPasswordUrl: string,
): Promise<boolean> {
  const body = [
    greeting(name),
    p(
      `El equipo de MamboSon te creó una cuenta con este correo (<strong>${esc(to)}</strong>). Solo falta que definas tu contraseña para entrar.`,
    ),
    button("Definir mi contraseña", setPasswordUrl),
    small(
      'El enlace funciona durante 7 días. Si se vence, entra a la web, elige "Olvidé mi contraseña" y te llega uno nuevo.',
    ),
  ].join("");
  return sendEmail(to, "Tu cuenta en MamboSon está lista", layout("Tu cuenta está lista", body));
}

export interface OrderPaidEmail {
  name?: string;
  number: string;
  items: { title: string; quantity: number; unitCents: number; detail?: string }[];
  totalCents: number;
  tickets: {
    code: string;
    eventTitle: string;
    tierName: string;
    startsAt?: Date | string | null;
  }[];
  courseTitles: string[];
  hasPhysical: boolean;
  shippingNote?: string;
}

export async function sendOrderPaid(to: string, data: OrderPaidEmail): Promise<boolean> {
  const rows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border}">
          ${esc(item.title)}${item.quantity > 1 ? ` × ${item.quantity}` : ""}
          ${item.detail ? `<br><span style="color:${BRAND.muted};font-size:13px">${esc(item.detail)}</span>` : ""}
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.border};white-space:nowrap">${money(item.unitCents * item.quantity)}</td>
      </tr>`,
    )
    .join("");

  const table = `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 20px;font-size:15px">
      ${rows}
      <tr>
        <td style="padding:12px 0;font-weight:bold">Total</td>
        <td align="right" style="padding:12px 0;font-weight:bold">${money(data.totalCents)}</td>
      </tr>
    </table>`;

  const parts = [
    greeting(data.name),
    p(`Recibimos tu pago. Este es el resumen de tu pedido <strong>${esc(data.number)}</strong>:`),
    table,
  ];

  if (data.tickets.length) {
    const codes = data.tickets
      .map(
        (ticket) => `
        <tr><td style="padding:12px 16px;border:1px solid ${BRAND.border};border-radius:12px">
          <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:bold;letter-spacing:2px;color:${BRAND.wine}">${esc(ticket.code)}</div>
          <div style="color:${BRAND.muted};font-size:13px">${esc(ticket.eventTitle)} · ${esc(ticket.tierName)}${ticket.startsAt ? ` · ${esc(formatDateTime(ticket.startsAt))}` : ""}</div>
        </td></tr>
        <tr><td style="height:8px"></td></tr>`,
      )
      .join("");
    parts.push(
      `<h2 style="margin:8px 0 10px;font-size:17px">Tus entradas</h2>`,
      p("Muestra el código en la puerta. Cada código sirve para una persona y un solo ingreso."),
      `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">${codes}</table>`,
    );
  }

  if (data.courseTitles.length) {
    parts.push(
      `<h2 style="margin:16px 0 10px;font-size:17px">Tus clases</h2>`,
      p(
        `Ya puedes empezar con ${data.courseTitles.map((title) => `<strong>${esc(title)}</strong>`).join(", ")}. Te espera en tu cuenta, para verlo las veces que quieras.`,
      ),
    );
  }

  if (data.hasPhysical) {
    parts.push(
      `<h2 style="margin:16px 0 10px;font-size:17px">Tu envío</h2>`,
      p(
        esc(
          data.shippingNote ||
            "Estamos preparando tu pedido. Te escribimos para coordinar la entrega.",
        ),
      ),
    );
  }

  parts.push(button("Ver mi cuenta", links.account()), small("Gracias por bailar con nosotros."));

  return sendEmail(
    to,
    `Compra confirmada · pedido ${data.number}`,
    layout("Tu compra está confirmada", parts.join("")),
  );
}

export interface AccessGrantedEmail {
  name?: string;
  productTitles: string[];
  expiresAt: Date | string | null;
  productSlug?: string;
}

export async function sendAccessGranted(to: string, data: AccessGrantedEmail): Promise<boolean> {
  const list = data.productTitles.map((title) => `<li style="margin:0 0 6px">${esc(title)}</li>`);
  const body = [
    greeting(data.name),
    p("El equipo de MamboSon te dio acceso a:"),
    `<ul style="margin:0 0 16px;padding-left:20px;font-weight:bold">${list.join("")}</ul>`,
    p(accessSentence(data.expiresAt)),
    button("Empezar a bailar", links.course(data.productSlug)),
    small("Entra con este mismo correo. A tu ritmo, sin prisa."),
  ].join("");
  return sendEmail(to, "Tienes un nuevo acceso en MamboSon", layout("Tu acceso está activo", body));
}

export interface AccessExpiringEmail {
  name?: string;
  productTitle: string;
  productSlug?: string;
  daysLeft: number;
  expiresAt: Date | string;
}

/** `daysLeft` 0 = el acceso vence hoy; cualquier otro valor = aviso previo. */
export async function sendAccessExpiring(to: string, data: AccessExpiringEmail): Promise<boolean> {
  const title = esc(data.productTitle);
  const isToday = data.daysLeft <= 0;
  const when = isToday
    ? "vence hoy"
    : `vence en ${data.daysLeft} ${data.daysLeft === 1 ? "día" : "días"}`;

  const body = [
    greeting(data.name),
    p(`Tu acceso a <strong>${title}</strong> ${when} (${esc(formatLongDate(data.expiresAt))}).`),
    p(
      isToday
        ? "Si quieres seguir practicando, puedes renovarlo desde la web cuando gustes. Tu progreso queda guardado."
        : "Aprovecha estos días para repasar las clases que te faltan. Si quieres más tiempo, puedes renovarlo desde la web.",
    ),
    button(isToday ? "Renovar mi acceso" : "Ir a mis clases", links.course(data.productSlug)),
  ].join("");

  const subject = isToday
    ? `Tu acceso a ${data.productTitle} vence hoy`
    : `Tu acceso a ${data.productTitle} ${when}`;
  return sendEmail(
    to,
    subject,
    layout(isToday ? "Tu acceso vence hoy" : "Tu acceso está por vencer", body),
  );
}

export interface LoyaltyStampEmail {
  name?: string;
  currentCount: number;
  stampsRequired: number;
  rewardText: string;
}

export async function sendLoyaltyStamp(to: string, data: LoyaltyStampEmail): Promise<boolean> {
  const left = Math.max(data.stampsRequired - data.currentCount, 0);
  const body = [
    greeting(data.name),
    p("Sumaste un sello en tu tarjeta de fidelidad."),
    p(
      `Llevas <strong>${data.currentCount} de ${data.stampsRequired}</strong>. ${
        left === 1 ? "Te falta solo uno" : `Te faltan ${left}`
      } para tu premio${data.rewardText ? `: ${esc(data.rewardText)}` : ""}.`,
    ),
    button("Ver mi tarjeta", links.account()),
  ].join("");
  return sendEmail(to, "Sumaste un sello en MamboSon", layout("Nuevo sello en tu tarjeta", body));
}

export interface LoyaltyRewardEmail {
  name?: string;
  rewardText: string;
}

export async function sendLoyaltyReward(to: string, data: LoyaltyRewardEmail): Promise<boolean> {
  const body = [
    greeting(data.name),
    p("Completaste tu tarjeta de fidelidad. Te lo ganaste paso a paso."),
    data.rewardText
      ? `<p style="margin:0 0 16px;padding:16px 20px;background:${BRAND.background};border:1px solid ${BRAND.border};border-radius:12px;font-weight:bold;color:${BRAND.wine}">${esc(data.rewardText)}</p>`
      : "",
    p(
      "Para canjearlo, avísale al equipo en la academia o escríbenos. Tu tarjeta ya empezó un ciclo nuevo para que sigas sumando.",
    ),
    button("Ver mi tarjeta", links.account()),
  ].join("");
  return sendEmail(to, "Desbloqueaste tu premio en MamboSon", layout("Tienes un premio", body));
}
