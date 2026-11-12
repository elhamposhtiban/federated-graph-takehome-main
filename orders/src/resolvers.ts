import { GraphQLError } from "graphql";

import { confirmedOrdersFor, getOrder } from "./store.js";

export function createResolvers() {
  return {
    Query: {
      order: (_: unknown, { id }: { id: string }) => getOrder(id) ?? null,
    },
    Mutation: {
      placeOrder: () => {
        throw new GraphQLError("placeOrder is not implemented yet", {
          extensions: { code: "NOT_IMPLEMENTED" },
        });
      },
    },
    Product: {
      // Derived from order state, so duplicate events can never inflate it.
      orderCount: (product: { id: string }) => confirmedOrdersFor(product.id).length,
    },
  };
}
