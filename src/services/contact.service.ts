import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import { layout, sendEmail } from "./email.service";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lo que escribe la persona termina dentro de un HTML: sin escapar, un <script> o un enlace falso llegaría al buzón del equipo.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function sendContactMessage(input: Record<string, unknown>): Promise<void> {
  const name = clean(input.name);
  const email = clean(input.email).toLowerCase();
  const phone = clean(input.phone);
  const message = clean(input.message);

  if (!name) throw new CustomError("Escribe tu nombre", 400);
  if (!EMAIL_REGEX.test(email)) throw new CustomError("Escribe un correo válido", 400);
  if (!message) throw new CustomError("Escribe tu mensaje", 400);
  if (name.length > 120 || email.length > 200 || phone.length > 40) {
    throw new CustomError("Revisa los datos de contacto: alguno es demasiado largo", 400);
  }
  if (message.length > 5000) {
    throw new CustomError("El mensaje no puede pasar de 5000 caracteres", 400);
  }

  const body = `
    <p><strong>Nombre:</strong> ${escapeHtml(name)}</p>
    <p><strong>Correo:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
    ${phone ? `<p><strong>Teléfono:</strong> ${escapeHtml(phone)}</p>` : ""}
    <p><strong>Mensaje:</strong></p>
    <p style="white-space:pre-line">${escapeHtml(message)}</p>`;

  const sent = await sendEmail(
    env.TEAM_EMAIL,
    `Nuevo mensaje de contacto — ${name.replace(/\s+/g, " ").slice(0, 80)}`,
    layout("Nuevo mensaje desde la web", body),
  );

  // Decir "enviado" cuando no salió sería perder el contacto sin que nadie se entere.
  if (!sent) {
    throw new CustomError(
      "No pudimos enviar tu mensaje en este momento. Escríbenos por WhatsApp o Instagram.",
      503,
    );
  }
}
