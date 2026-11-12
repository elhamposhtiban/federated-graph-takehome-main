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
