import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";

import { typeDefs } from "./schema.js";
import { createResolvers } from "./resolvers.js";
import { fetchProductPrice } from "./products-client.js";

const resolvers = createResolvers({
  fetchProductPrice,
  // Replaced by the Kafka producer in step 3; until then orders stay PLACED.
  publishOrderPlaced: async (order) => console.log(`(no Kafka yet) placed ${order.id}`),
});

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

const { url } = await startStandaloneServer(server, {
  listen: { port: Number(process.env.PORT ?? 4002) },
});

console.log(`orders ready at ${url}`);
