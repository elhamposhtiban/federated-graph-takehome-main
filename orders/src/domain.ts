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
