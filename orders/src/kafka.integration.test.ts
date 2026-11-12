// Needs Kafka on localhost:9092 (`npm run kafka:up`). Skipped unless KAFKA_TESTS=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Order } from "./domain.js";
import { ORDER_PLACED_TOPIC, toOrderPlacedEvent } from "./events.js";
import type { HandleResult } from "./fulfillment.js";
import { ensureTopic, producer, startFulfillmentConsumer } from "./kafka.js";
import { confirmedOrdersFor, getOrder, saveOrder } from "./store.js";

async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the consumer");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test(
  "a message redelivered by Kafka settles and counts the order once",
  { skip: !process.env.KAFKA_TESTS && "set KAFKA_TESTS=1 with Kafka running" },
  async () => {
    const order: Order = {
      id: randomUUID(),
      productId: `kafka-test-${randomUUID()}`, // isolates orderCount from other runs
      quantity: 2,
      unitPricePaid: { amount: 2499, currency: "USD" },
      status: "PLACED",
      placedAt: new Date().toISOString(),
    };
    const ours: HandleResult[] = [];

    await producer.connect();
    await ensureTopic();
    // A fresh group so this run doesn't move the real consumer's offsets.
    const consumer = await startFulfillmentConsumer({
      groupId: `orders-test-${randomUUID()}`,
      onResult: (result) => {
        if (result.orderId === order.id) ours.push(result);
      },
    });

    try {
      saveOrder(order);
      const message = { key: order.id, value: JSON.stringify(toOrderPlacedEvent(order)) };
      // Same bytes twice, as Kafka would redeliver after a missed offset commit.
      await producer.send({ topic: ORDER_PLACED_TOPIC, messages: [message] });
      await producer.send({ topic: ORDER_PLACED_TOPIC, messages: [message] });

      await waitFor(() => ours.length === 2);
      assert.deepEqual(
        ours.map((r) => r.outcome),
        ["confirmed", "duplicate"],
      );
      assert.equal(getOrder(order.id)?.status, "CONFIRMED");
      assert.equal(confirmedOrdersFor(order.productId).length, 1);
    } finally {
      await consumer.disconnect();
      await producer.disconnect();
    }
  },
);
