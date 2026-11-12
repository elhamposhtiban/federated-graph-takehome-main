import { test } from "node:test";
import assert from "node:assert/strict";

import { decideOutcome, settle, type Order } from "./domain.js";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o1",
  productId: "1",
  quantity: 2,
  unitPricePaid: { amount: 2499, currency: "USD" },
  status: "PLACED",
  placedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("decideOutcome: up to 10 confirms, more than 10 rejects", () => {
  assert.equal(decideOutcome(1), "CONFIRMED");
  assert.equal(decideOutcome(10), "CONFIRMED");
  assert.equal(decideOutcome(11), "REJECTED");
});

test("settle moves a PLACED order to its outcome", () => {
  assert.deepEqual(settle(order({ quantity: 2 })), {
    order: order({ status: "CONFIRMED" }),
    changed: true,
  });
  assert.equal(settle(order({ quantity: 50 })).order.status, "REJECTED");
});

test("settle leaves already-settled orders alone", () => {
  for (const status of ["CONFIRMED", "REJECTED"] as const) {
    const settled = order({ status });
    assert.deepEqual(settle(settled), { order: settled, changed: false });
  }
});
