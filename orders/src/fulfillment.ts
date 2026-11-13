import { settle } from "./domain.js";
import { parseOrderPlaced } from "./events.js";
import { getOrder, saveOrder } from "./store.js";

export type Outcome = "confirmed" | "rejected" | "duplicate" | "unknown-order" | "malformed";

export interface HandleResult {
  outcome: Outcome;
  orderId?: string;
  eventId?: string;
}

// Never throws: a throw makes kafkajs retry the same message forever and block the partition.
export function handleOrderPlaced(raw: string | undefined): HandleResult {
  const event = parseOrderPlaced(raw);
  if (!event) return { outcome: "malformed" };

  const ids = { orderId: event.data.orderId, eventId: event.eventId };
  const order = getOrder(event.data.orderId);
  // e.g. the order was lost when this process restarted.
  if (!order) return { outcome: "unknown-order", ...ids };

  const { order: settled, changed } = settle(order);
  if (!changed) return { outcome: "duplicate", ...ids };

  saveOrder(settled);
  return { outcome: settled.status === "CONFIRMED" ? "confirmed" : "rejected", ...ids };
}
