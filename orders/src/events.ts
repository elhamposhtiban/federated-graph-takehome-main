import { randomUUID } from "node:crypto";

import type { Money, Order } from "./domain.js";

export const ORDER_PLACED_TOPIC = "orders.order-placed";

export interface OrderPlacedEvent {
  eventId: string;
  eventType: "OrderPlaced";
  version: 1;
  occurredAt: string;
  data: {
    orderId: string;
    productId: string;
    quantity: number;
    unitPricePaid: Money;
  };
}

export function toOrderPlacedEvent(order: Order): OrderPlacedEvent {
  return {
    eventId: randomUUID(),
    eventType: "OrderPlaced",
    version: 1,
    occurredAt: new Date().toISOString(),
    data: {
      orderId: order.id,
      productId: order.productId,
      quantity: order.quantity,
      unitPricePaid: order.unitPricePaid,
    },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

// Returns null instead of throwing: anything we can't trust is skipped, never retried forever.
export function parseOrderPlaced(raw: string | undefined): OrderPlacedEvent | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || !isObject(value.data)) return null;
  // Only v1 is understood; a newer shape is skipped rather than half-read.
  if (value.eventType !== "OrderPlaced" || value.version !== 1) return null;
  if (!isNonEmptyString(value.eventId) || !isNonEmptyString(value.occurredAt)) return null;

  const { orderId, productId, quantity, unitPricePaid } = value.data;
  if (!isNonEmptyString(orderId) || !isNonEmptyString(productId)) return null;
  if (!Number.isInteger(quantity) || (quantity as number) < 1) return null;
  if (
    !isObject(unitPricePaid) ||
    !Number.isInteger(unitPricePaid.amount) ||
    !isNonEmptyString(unitPricePaid.currency)
  ) {
    return null;
  }
  return value as unknown as OrderPlacedEvent;
}
