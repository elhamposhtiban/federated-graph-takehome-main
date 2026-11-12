import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";

import { typeDefs } from "./schema.js";
import { products, type Product } from "./data.js";

const resolvers = {
  Query: {
    products: () => products,
    product: (_: unknown, { id }: { id: string }) =>
      products.find((product) => product.id === id) ?? null,
  },
  Product: {
    __resolveReference: (reference: { id: string }): Product | undefined =>
      products.find((product) => product.id === reference.id),

    // Placeholder until the orders team serves this field from their own
    // subgraph. Returns 0 so the storefront renders today.
    // TODO(orders-team): take ownership of Product.orderCount.
    orderCount: () => 0,
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

const { url } = await startStandaloneServer(server, {
  listen: { port: 4001 },
});

console.log(`products ready at ${url}`);
