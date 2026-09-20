import { CustomError } from "../errors/customError.error";
import { ISettings, Settings, SETTINGS_KEY } from "../models/settings.model";

export type SettingsDTO = Pick<
  ISettings,
  | "loyaltyEnabled"
  | "loyaltyStampsRequired"
  | "loyaltyRewardText"
  | "loyaltyStampOnPurchase"
  | "whatsapp"
  | "instagram"
  | "shippingNote"
>;

/** Devuelve el singleton; lo crea con los defaults del schema la primera vez. */
export async function getSettings() {
  // Upsert atómico: dos peticiones simultáneas en frío no crean dos documentos.
  return Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/** Forma del contrato: sin id, key ni timestamps. */
export function toSettingsDTO(settings: ISettings): SettingsDTO {
  return {
    loyaltyEnabled: settings.loyaltyEnabled,
    loyaltyStampsRequired: settings.loyaltyStampsRequired,
    loyaltyRewardText: settings.loyaltyRewardText,
    loyaltyStampOnPurchase: settings.loyaltyStampOnPurchase,
    whatsapp: settings.whatsapp,
    instagram: settings.instagram,
    shippingNote: settings.shippingNote,
  };
}

export function toPublicSettings(settings: ISettings) {
  const { loyaltyStampOnPurchase: _omit, ...rest } = toSettingsDTO(settings);
  return rest;
}

export async function updateSettings(input: Record<string, unknown>) {
  const settings = await getSettings();

  for (const key of ["loyaltyEnabled", "loyaltyStampOnPurchase"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") {
      throw new CustomError(`El campo ${key} debe ser verdadero o falso`, 400);
    }
    settings[key] = input[key];
  }

  if (input.loyaltyStampsRequired !== undefined) {
    const value = Number(input.loyaltyStampsRequired);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new CustomError("Los sellos necesarios deben ser un número entero entre 1 y 100", 400);
    }
    settings.loyaltyStampsRequired = value;
  }

  for (const key of ["loyaltyRewardText", "whatsapp", "instagram", "shippingNote"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string") {
      throw new CustomError(`El campo ${key} debe ser texto`, 400);
    }
    settings[key] = input[key].trim();
  }

  if (!settings.loyaltyRewardText) {
    throw new CustomError("Escribe cuál es el premio de la tarjeta de fidelidad", 400);
  }

  await settings.save();
  return settings;
}
