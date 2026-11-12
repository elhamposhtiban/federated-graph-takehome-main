import type { Order } from "./domain.js";

// In memory like products; everything is lost on restart.
const orders = new Map<string, Order>();

export const saveOrder = (order: Order) => {
  orders.set(order.id, order);
};
export const getOrder = (id: string) => orders.get(id);
export const deleteOrder = (id: string) => orders.delete(id);
export const clearOrders = () => orders.clear();

export const confirmedOrdersFor = (productId: string) =>
  [...orders.values()].filter(
    (order) => order.productId === productId && order.status === "CONFIRMED",
  );
