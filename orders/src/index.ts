import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";

import { typeDefs } from "./schema.js";
import { createResolvers } from "./resolvers.js";
import { fetchProductPrice } from "./products-client.js";
import { ensureTopic, producer, publishOrderPlaced, startFulfillmentConsumer } from "./kafka.js";

// Kafka first: fail fast rather than accept orders we can't publish.
await producer.connect();
await ensureTopic();
const consumer = await startFulfillmentConsumer();

const server = new ApolloServer({
  schema: buildSubgraphSchema([
    { typeDefs, resolvers: createResolvers({ fetchProductPrice, publishOrderPlaced }) },
  ]),
  // Apollo's own signal handler re-raises the signal and kills the process
  // before the consumer can leave its group; shutdown() below owns this instead.
  stopOnTerminationSignals: false,
});

const { url } = await startStandaloneServer(server, {
  listen: { port: Number(process.env.PORT ?? 4002) },
});

console.log(`orders ready at ${url}`);

// Leaving the group cleanly hands the partition back at once instead of after a session timeout.
async function shutdown() {
  console.log("orders shutting down");
  await Promise.allSettled([consumer.disconnect(), producer.disconnect(), server.stop()]);
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
