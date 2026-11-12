import { test } from "node:test";
import assert from "node:assert/strict";
import { composeServices } from "@apollo/composition";
import type { DocumentNode } from "graphql";

import { typeDefs as ordersTypeDefs } from "./schema.js";

// Read-only import of the products team's real schema, so this breaks if theirs changes.
// A computed path keeps it out of orders' tsc rootDir.
const productsSchemaPath = new URL("../../products/src/schema.ts", import.meta.url).href;
const { typeDefs: productsTypeDefs } = (await import(productsSchemaPath)) as {
  typeDefs: DocumentNode;
};

const result = composeServices([
  { name: "products", url: "http://localhost:4001/graphql", typeDefs: productsTypeDefs },
  { name: "orders", url: "http://localhost:4002/graphql", typeDefs: ordersTypeDefs },
]);

test("orders composes with products with zero errors", () => {
  assert.deepEqual(result.errors?.map((e) => e.message) ?? [], []);
});

test("the supergraph routes Product.orderCount to orders", () => {
  assert.ok(result.supergraphSdl);
  assert.match(
    result.supergraphSdl,
    /orderCount: Int! @join__field\(graph: ORDERS, override: "products"\)/,
  );
});
