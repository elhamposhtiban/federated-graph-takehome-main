export interface Money {
  amount: number;
  currency: string;
}

export type OrderStatus = "PLACED" | "CONFIRMED" | "REJECTED";

export interface Order {
  id: string;
  productId: string;
  quantity: number;
  unitPricePaid: Money;
  status: OrderStatus;
  placedAt: string;
}

// README item 2; stands in for a real stock check.
export const decideOutcome = (quantity: number): "CONFIRMED" | "REJECTED" =>
  quantity > 10 ? "REJECTED" : "CONFIRMED";

// Only PLACED orders can settle; makes duplicate events a no-op.
export function settle(order: Order): { order: Order; changed: boolean } {
  if (order.status !== "PLACED") return { order, changed: false };
  return { order: { ...order, status: decideOutcome(order.quantity) }, changed: true };
}
