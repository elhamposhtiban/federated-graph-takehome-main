import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";

import type { Money, Order } from "./domain.js";
import type { ProductPrice } from "./products-client.js";
import { confirmedOrdersFor, deleteOrder, getOrder, saveOrder } from "./store.js";

// Passed in so tests can swap products and Kafka for fakes.
export interface ResolverDeps {
  fetchProductPrice: (id: string) => Promise<ProductPrice | null>;
  publishOrderPlaced: (order: Order) => Promise<void>;
}

const fail = (message: string, code: string) =>
  new GraphQLError(message, { extensions: { code } });

export function createResolvers({ fetchProductPrice, publishOrderPlaced }: ResolverDeps) {
  return {
    Query: {
      order: (_: unknown, { id }: { id: string }) => getOrder(id) ?? null,
    },
    Mutation: {
      placeOrder: async (
        _: unknown,
        { productId, quantity }: { productId: string; quantity: number },
      ) => {
        // Over 10 is valid input; fulfillment rejects it later, not the mutation.
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw fail("quantity must be a whole number of at least 1", "BAD_USER_INPUT");
        }

        let product: ProductPrice | null;
        try {
          product = await fetchProductPrice(productId);
        } catch {
          // An outage must not be reported as "product doesn't exist".
          throw fail("products is unavailable, try again", "PRODUCTS_UNAVAILABLE");
        }
        if (!product) throw fail(`product ${productId} does not exist`, "PRODUCT_NOT_FOUND");

        const order: Order = {
          id: randomUUID(),
          productId,
          quantity,
          // Snapshot: the price paid never follows later catalog changes.
          unitPricePaid: { ...product.price },
          status: "PLACED",
          placedAt: new Date().toISOString(),
        };

        // Save before publishing so the consumer never sees an event for an unknown order.
        saveOrder(order);
        try {
          await publishOrderPlaced(order);
        } catch {
          deleteOrder(order.id);
          throw fail("order could not be placed, try again", "ORDER_NOT_PLACED");
        }
        return order;
      },
    },
    Order: {
      // A reference only; the gateway fetches name/category from products via federation.
      product: (order: Order) => ({ __typename: "Product", id: order.productId }),
    },
    Product: {
      // Derived from order state, so duplicate events can never inflate it.
      orderCount: (product: { id: string }) => confirmedOrdersFor(product.id).length,
      // price arrives from products via @requires on every request; it is never stored here.
      revenue: (product: { id: string; price: Money }) => {
        const quantity = confirmedOrdersFor(product.id).reduce((sum, o) => sum + o.quantity, 0);
        return { amount: quantity * product.price.amount, currency: product.price.currency };
      },
    },
  };
}
