import mongoose, { Schema, Types } from "mongoose";
import { jsonPlugin } from "../utils/jsonPlugin";

export const TICKET_STATUSES = ["valid", "used", "void"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface ITicket {
  code: string;
  event: Types.ObjectId;
  tierId: string;
  tierName: string;
  holderName: string;
  holderEmail: string;
  user: Types.ObjectId;
  order: Types.ObjectId;
  status: TicketStatus;
  usedAt: Date | null;
  checkedInBy: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const ticketSchema = new Schema<ITicket>(
  {
    // 10 caracteres; es lo que va en el correo y en el QR.
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    event: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    tierId: { type: String, default: "" },
    tierName: { type: String, default: "" },
    holderName: { type: String, default: "" },
    holderEmail: { type: String, default: "", lowercase: true, trim: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    status: { type: String, enum: TICKET_STATUSES, default: "valid" },
    usedAt: { type: Date, default: null },
    checkedInBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

ticketSchema.plugin(jsonPlugin);

export const Ticket =
  (mongoose.models.Ticket as mongoose.Model<ITicket>) ||
  mongoose.model<ITicket>("Ticket", ticketSchema);
