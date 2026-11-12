import { settle } from "./domain.js";
import type { OrderPlacedEvent } from "./events.js";
import { getOrder, saveOrder } from "./store.js";

export type Outcome = "confirmed" | "rejected" | "duplicate" | "unknown-order";

export function handleOrderPlaced(event: OrderPlacedEvent): Outcome {
  const order = getOrder(event.data.orderId);
  // e.g. the order was lost when this process restarted.
  if (!order) return "unknown-order";

  const { order: settled, changed } = settle(order);
  if (!changed) return "duplicate";

  saveOrder(settled);
  return settled.status === "CONFIRMED" ? "confirmed" : "rejected";
}
