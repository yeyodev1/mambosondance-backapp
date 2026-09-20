import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

export const PAYPHONE_APPROVED = 3;
export const PAYPHONE_CANCELED = 2;

export interface PayphoneConfirmation {
  statusCode?: number;
  transactionStatus?: string;
  amount?: number;
  clientTransactionId?: string;
  transactionId?: number;
  message?: string;
  errorCode?: number;
  [key: string]: unknown;
}

export function isPayphoneConfigured(): boolean {
  return !!(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

/**
 * Configuración que la Cajita necesita en el navegador. El token viaja al
 * frontend por diseño de Payphone; se entrega desde acá para poder rotarlo
 * sin redeploy del frontapp. Nunca se escribe en logs.
 */
export function boxCredentials(): { token: string; storeId: string } {
  return { token: env.PAYPHONE_TOKEN, storeId: env.PAYPHONE_STORE_ID };
}

/**
 * Confirma la transacción contra Payphone. Hay que llamarlo dentro de los 5
 * minutos posteriores al pago o Payphone reversa el cobro.
 *
 * Un rechazo con cuerpo (`{ message, errorCode }`) se devuelve tal cual para que
 * la orden lo guarde; solo se lanza si Payphone no respondió nada útil.
 */
export async function confirmTransaction(
  id: string | number,
  clientTransactionId: string,
): Promise<PayphoneConfirmation> {
  if (!isPayphoneConfigured()) {
    throw new CustomError("Los pagos en línea aún no están habilitados", 503);
  }

  try {
    const { data } = await axios.post<PayphoneConfirmation>(
      CONFIRM_URL,
      { id: Number(id), clientTxId: clientTransactionId },
      { headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}` }, timeout: 25000 },
    );
    return data ?? {};
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response?.data &&
      typeof error.response.data === "object"
    ) {
      return error.response.data as PayphoneConfirmation;
    }
    // Solo el mensaje: el objeto de error de axios incluye el header con el token.
    console.error(
      "[payphone] no se pudo confirmar la transacción:",
      error instanceof Error ? error.message : "error desconocido",
    );
    throw new CustomError(
      "No pudimos confirmar tu pago con Payphone. Recarga la página en unos segundos",
      502,
    );
  }
}
