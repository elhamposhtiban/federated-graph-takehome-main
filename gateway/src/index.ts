import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { ApolloGateway, IntrospectAndCompose } from "@apollo/gateway";

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: "products", url: "http://localhost:4001/graphql" },
      { name: "orders", url: "http://localhost:4002/graphql" },
    ],
  }),
});

const server = new ApolloServer({ gateway });

const { url } = await startStandaloneServer(server, {
  listen: { port: 4000 },
});

console.log(`gateway ready at ${url}`);
