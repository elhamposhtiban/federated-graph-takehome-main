import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import type { Order } from "./domain.js";
import { parseOrderPlaced, toOrderPlacedEvent } from "./events.js";
import { handleOrderPlaced } from "./fulfillment.js";
import { clearOrders, confirmedOrdersFor, getOrder, saveOrder } from "./store.js";

const placed = (id: string, quantity: number): Order => ({
  id,
  productId: "1",
  quantity,
  unitPricePaid: { amount: 2499, currency: "USD" },
  status: "PLACED",
  placedAt: "2026-01-01T00:00:00.000Z",
});

// The exact string the producer would put on the topic.
const message = (order: Order) => JSON.stringify(toOrderPlacedEvent(order));

beforeEach(() => clearOrders());

test("event round-trips through the producer shape and the parser", () => {
  const event = toOrderPlacedEvent(placed("o1", 2));
  assert.deepEqual(parseOrderPlaced(JSON.stringify(event)), event);
  assert.equal(event.version, 1);
  assert.equal(event.data.orderId, "o1");
});

test("confirms an order of 10 or fewer", () => {
  saveOrder(placed("o1", 10));
  assert.deepEqual(handleOrderPlaced(message(placed("o1", 10))).outcome, "confirmed");
  assert.equal(getOrder("o1")?.status, "CONFIRMED");
});

test("rejects an order of more than 10, and it doesn't count", () => {
  saveOrder(placed("o1", 11));
  assert.equal(handleOrderPlaced(message(placed("o1", 11))).outcome, "rejected");
  assert.equal(getOrder("o1")?.status, "REJECTED");
  assert.equal(confirmedOrdersFor("1").length, 0);
});

test("the same message delivered twice settles and counts once", () => {
  saveOrder(placed("o1", 2));
  const raw = message(placed("o1", 2));

  const first = handleOrderPlaced(raw);
  const second = handleOrderPlaced(raw);

  assert.equal(first.outcome, "confirmed");
  assert.equal(second.outcome, "duplicate");
  assert.equal(second.eventId, first.eventId);
  assert.equal(getOrder("o1")?.status, "CONFIRMED");
  assert.equal(confirmedOrdersFor("1").length, 1);
});

test("an event for an order we don't have is skipped", () => {
  const result = handleOrderPlaced(message(placed("lost-in-restart", 2)));
  assert.equal(result.outcome, "unknown-order");
  assert.equal(result.orderId, "lost-in-restart");
});

test("malformed messages are skipped without throwing", () => {
  const valid = toOrderPlacedEvent(placed("o1", 2));
  const bad: (string | undefined)[] = [
    undefined,
    "",
    "not json",
    "null",
    "[]",
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, eventType: "OrderCancelled" }),
    JSON.stringify({ ...valid, eventId: undefined }),
    JSON.stringify({ ...valid, data: { ...valid.data, quantity: undefined } }),
    JSON.stringify({ ...valid, data: { ...valid.data, quantity: 0 } }),
    JSON.stringify({ ...valid, data: { ...valid.data, quantity: 2.5 } }),
    JSON.stringify({ ...valid, data: { ...valid.data, unitPricePaid: { amount: "2499" } } }),
  ];
  saveOrder(placed("o1", 2));
  for (const raw of bad) {
    assert.equal(handleOrderPlaced(raw).outcome, "malformed", `expected malformed: ${raw}`);
  }
  assert.equal(getOrder("o1")?.status, "PLACED");
});
