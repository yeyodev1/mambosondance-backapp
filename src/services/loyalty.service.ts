import { isValidObjectId, Types } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { LoyaltyCard, StampSource } from "../models/loyaltyCard.model";
import { User } from "../models/user.model";
import * as authService from "./auth.service";
import * as emailService from "./email.service";
import { getSettings } from "./settings.service";

type Id = string | Types.ObjectId;

const MAX_STAMPS_PER_REQUEST = 20;
const HISTORY_LIMIT = 100;

/** Forma `LoyaltyCard` del contrato: los datos de la tarjeta más las reglas vigentes de settings. */
function serializeCard(card: any, settings: any) {
  const stamps = (card?.stamps ?? []).map((stamp: any) => ({
    id: String(stamp._id),
    at: stamp.at,
    note: stamp.note,
    source: stamp.source,
  }));
  const history = [...(card?.history ?? [])]
    .map((entry: any) => ({ at: entry.at, type: entry.type, note: entry.note }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, HISTORY_LIMIT);

  return {
    stampsRequired: settings.loyaltyStampsRequired,
    rewardText: settings.loyaltyRewardText,
    stamps,
    currentCount: stamps.length,
    rewardsAvailable: card?.rewardsAvailable ?? 0,
    rewardsRedeemed: card?.rewardsRedeemed ?? 0,
    history,
  };
}

/** Quien todavía no tiene sellos recibe una tarjeta vacía, no un 404. */
export async function getCard(userId: Id) {
  const [card, settings] = await Promise.all([
    LoyaltyCard.findOne({ user: userId }),
    getSettings(),
  ]);
  return serializeCard(card, settings);
}

async function findOrCreateCard(userId: Id) {
  return LoyaltyCard.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/**
 * Agrega `count` sellos. Cuando el ciclo llega a `stampsRequired` la tarjeta se
 * vacía, suma un premio disponible y sale el correo de premio; si no, sale el
 * correo de sello (uno solo aunque se agreguen varios).
 */
export async function addStamp(input: {
  userId: Id;
  source: StampSource;
  note?: string;
  count?: number;
}) {
  const settings = await getSettings();
  const required = Math.max(1, Number(settings.loyaltyStampsRequired) || 1);
  const count = Math.floor(Number(input.count ?? 1));
  if (!Number.isFinite(count) || count < 1 || count > MAX_STAMPS_PER_REQUEST) {
    throw new CustomError(
      `La cantidad de sellos debe estar entre 1 y ${MAX_STAMPS_PER_REQUEST}`,
      400,
    );
  }
  const note = (input.note || "").trim();

  let rewardsEarned = 0;
  let card: any = null;

  // Dos sellos simultáneos sobre la misma tarjeta chocan en el versionado de
  // Mongoose; se reintenta con el documento fresco en vez de perder un sello.
  for (let attempt = 0; attempt < 3; attempt++) {
    card = await findOrCreateCard(input.userId);
    rewardsEarned = 0;

    for (let i = 0; i < count; i++) {
      const at = new Date();
      card.stamps.push({ at, note, source: input.source });
      card.history.push({ at, type: "stamp", note });

      if (card.stamps.length >= required) {
        card.stamps.splice(0, card.stamps.length);
        card.rewardsAvailable += 1;
        card.history.push({ at, type: "reward_earned", note: settings.loyaltyRewardText });
        rewardsEarned += 1;
      }
    }

    try {
      await card.save();
      break;
    } catch (error: any) {
      if (error?.name !== "VersionError" || attempt === 2) throw error;
    }
  }

  const user: any = await User.findById(input.userId).select("email name");
  if (user) {
    if (rewardsEarned > 0) {
      await emailService.sendLoyaltyReward(user.email, {
        name: user.name,
        rewardText: settings.loyaltyRewardText,
      });
    } else {
      await emailService.sendLoyaltyStamp(user.email, {
        name: user.name,
        currentCount: card.stamps.length,
        stampsRequired: required,
        rewardText: settings.loyaltyRewardText,
      });
    }
  }

  return serializeCard(card, settings);
}

export async function redeem(userId: Id, note?: string) {
  const settings = await getSettings();
  // Condición y descuento en la misma operación: dos canjes a la vez no gastan el mismo premio.
  const card = await LoyaltyCard.findOneAndUpdate(
    { user: userId, rewardsAvailable: { $gt: 0 } },
    {
      $inc: { rewardsAvailable: -1, rewardsRedeemed: 1 },
      $push: {
        history: {
          at: new Date(),
          type: "reward_redeemed",
          note: (note || "").trim() || settings.loyaltyRewardText,
        },
      },
    },
    { new: true },
  );
  if (!card) throw new CustomError("Esta persona no tiene premios disponibles para canjear", 409);
  return serializeCard(card, settings);
}

/** Solo sellos del ciclo actual: los de ciclos cerrados ya se convirtieron en premio. */
export async function removeStamp(userId: Id, stampId: string) {
  if (!isValidObjectId(stampId)) throw new CustomError("Sello no encontrado", 404);
  const settings = await getSettings();
  const card = await LoyaltyCard.findOneAndUpdate(
    { user: userId, "stamps._id": stampId },
    { $pull: { stamps: { _id: stampId } } },
    { new: true },
  );
  if (!card) throw new CustomError("Sello no encontrado", 404);
  return serializeCard(card, settings);
}

// ─── Admin: todo se opera por correo del alumno ────────────────────────

async function requireUserByEmail(email: unknown) {
  const normalized = String(email || "")
    .toLowerCase()
    .trim();
  if (!normalized) throw new CustomError("Escribe el correo del alumno", 400);
  const user = await User.findOne({ email: normalized });
  if (!user) throw new CustomError("No hay ninguna cuenta con ese correo", 404);
  return user;
}

export async function stampByEmail(input: {
  email: unknown;
  note?: unknown;
  count?: unknown;
  source?: unknown;
}) {
  const settings = await getSettings();
  if (!settings.loyaltyEnabled) {
    throw new CustomError("La tarjeta de fidelidad está desactivada en los ajustes", 400);
  }

  const { user, created, setPasswordUrl } = await authService.findOrCreateUserByEmail(
    String(input.email || ""),
  );
  if (created && setPasswordUrl) {
    await emailService.sendAccountCreated(user.email, user.name, setPasswordUrl);
  }

  return addStamp({
    userId: user._id,
    // Lo habitual es sellar en la academia al llegar a clase; "manual" queda para ajustes.
    source: input.source === "manual" ? "manual" : "attendance",
    note: input.note ? String(input.note) : "",
    count: input.count === undefined || input.count === null ? 1 : Number(input.count),
  });
}

export async function redeemByEmail(input: { email: unknown; note?: unknown }) {
  const user = await requireUserByEmail(input.email);
  return redeem(user._id, input.note ? String(input.note) : "");
}

export async function removeStampByEmail(email: unknown, stampId: string) {
  const user = await requireUserByEmail(email);
  return removeStamp(user._id, stampId);
}
