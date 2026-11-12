import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginInlineTraceDisabled } from "@apollo/server/plugin/disabled";
import { buildSubgraphSchema } from "@apollo/subgraph";

import type { Order } from "./domain.js";
import type { ProductPrice } from "./products-client.js";
import { createResolvers, type ResolverDeps } from "./resolvers.js";
import { typeDefs } from "./schema.js";
import { clearOrders, getOrder, saveOrder } from "./store.js";

// Fake catalog; tests mutate it to simulate products changing.
let catalog: Record<string, ProductPrice>;
let published: Order[];

const fakes = (overrides: Partial<ResolverDeps> = {}): ResolverDeps => ({
  fetchProductPrice: async (id) => catalog[id] ?? null,
  publishOrderPlaced: async (order) => {
    published.push(order);
  },
  ...overrides,
});

async function run(query: string, deps: ResolverDeps = fakes()) {
  const server = new ApolloServer({
    schema: buildSubgraphSchema([{ typeDefs, resolvers: createResolvers(deps) }]),
    // One server per test: skip the signal handlers and the inline-tracing log line.
    stopOnTerminationSignals: false,
    plugins: [ApolloServerPluginInlineTraceDisabled()],
  });
  const res = await server.executeOperation({ query });
  assert.equal(res.body.kind, "single");
  // graphql-js builds null-prototype objects, which deepStrictEqual treats as different.
  return JSON.parse(JSON.stringify(res.body.singleResult)) as {
    data?: Record<string, any> | null;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
}

const errorCode = (result: Awaited<ReturnType<typeof run>>) => result.errors?.[0]?.extensions?.code;

const PLACE = `mutation { placeOrder(productId: "1", quantity: 2) {
  id status quantity unitPricePaid { amount currency } } }`;

beforeEach(() => {
  clearOrders();
  published = [];
  catalog = { "1": { id: "1", price: { amount: 2499, currency: "USD" } } };
});

test("placeOrder records a PLACED order with the catalog price and publishes it", async () => {
  const { data, errors } = await run(PLACE);
  assert.equal(errors, undefined);
  const order = data!.placeOrder;

  assert.equal(order.status, "PLACED");
  assert.deepEqual(order.unitPricePaid, { amount: 2499, currency: "USD" });
  assert.equal(getOrder(order.id)?.status, "PLACED");
  assert.equal(published.length, 1);
  assert.equal(published[0]!.id, order.id);
});

test("placeOrder accepts more than 10; rejecting is fulfillment's job", async () => {
  const { data } = await run(`mutation { placeOrder(productId: "1", quantity: 50) { status } }`);
  assert.equal(data!.placeOrder.status, "PLACED");
});

test("the price paid doesn't follow later catalog changes", async () => {
  const { data } = await run(PLACE);
  catalog["1"]!.price.amount = 9999;

  const { data: after } = await run(`{ order(id: "${data!.placeOrder.id}") { unitPricePaid { amount } } }`);
  assert.equal(after!.order.unitPricePaid.amount, 2499);
});

test("placeOrder rejects a quantity below 1", async () => {
  for (const quantity of [0, -3]) {
    const result = await run(`mutation { placeOrder(productId: "1", quantity: ${quantity}) { id } }`);
    assert.equal(errorCode(result), "BAD_USER_INPUT");
  }
  assert.equal(published.length, 0);
});

test("placeOrder reports an unknown product", async () => {
  const result = await run(`mutation { placeOrder(productId: "99", quantity: 2) { id } }`);
  assert.equal(errorCode(result), "PRODUCT_NOT_FOUND");
  assert.equal(published.length, 0);
});

test("placeOrder tells an outage apart from a missing product", async () => {
  const down = fakes({
    fetchProductPrice: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(errorCode(await run(PLACE, down)), "PRODUCTS_UNAVAILABLE");
});

test("a failed publish removes the saved order", async () => {
  let attempted: Order | undefined;
  const kafkaDown = fakes({
    publishOrderPlaced: async (order) => {
      attempted = order;
      throw new Error("broker unavailable");
    },
  });

  assert.equal(errorCode(await run(PLACE, kafkaDown)), "ORDER_NOT_PLACED");
  assert.ok(attempted, "publish was attempted");
  assert.equal(getOrder(attempted.id), undefined);
});

test("order(id) returns null for an unknown id", async () => {
  const { data } = await run(`{ order(id: "nope") { id } }`);
  assert.equal(data!.order, null);
});

test("Order.product is a reference the gateway can resolve", async () => {
  const { data } = await run(PLACE);
  const { data: after } = await run(`{ order(id: "${data!.placeOrder.id}") { product { __typename id } } }`);
  assert.deepEqual(after!.order.product, { __typename: "Product", id: "1" });
});

test("Product.orderCount counts only confirmed orders", async () => {
  const base = { productId: "1", quantity: 1, unitPricePaid: { amount: 1, currency: "USD" }, placedAt: "" };
  saveOrder({ ...base, id: "a", status: "CONFIRMED" });
  saveOrder({ ...base, id: "b", status: "CONFIRMED" });
  saveOrder({ ...base, id: "c", status: "REJECTED" });
  saveOrder({ ...base, id: "d", status: "PLACED" });
  saveOrder({ ...base, id: "e", productId: "2", status: "CONFIRMED" });

  // The same call the gateway makes when a query selects orderCount.
  const { data } = await run(`{
    _entities(representations: [
      { __typename: "Product", id: "1" },
      { __typename: "Product", id: "3" }
    ]) { ... on Product { id orderCount } }
  }`);
  assert.deepEqual(data!._entities, [
    { id: "1", orderCount: 2 },
    { id: "3", orderCount: 0 },
  ]);
});
