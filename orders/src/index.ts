import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";

import { typeDefs } from "./schema.js";
import { createResolvers } from "./resolvers.js";

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers: createResolvers() }]),
});

const { url } = await startStandaloneServer(server, {
  listen: { port: Number(process.env.PORT ?? 4002) },
});

console.log(`orders ready at ${url}`);
