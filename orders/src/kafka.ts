import { Kafka, Partitioners, logLevel } from "kafkajs";

import type { Order } from "./domain.js";
import { ORDER_PLACED_TOPIC, toOrderPlacedEvent } from "./events.js";
import { handleOrderPlaced } from "./fulfillment.js";

const kafka = new Kafka({
  clientId: "orders",
  brokers: [process.env.KAFKA_BROKER ?? "localhost:9092"],
  logLevel: logLevel.WARN,
});

// Explicit partitioner: same key → same partition, and silences kafkajs's v2 migration warning.
export const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });

// Created explicitly so the partition count is a decision, not broker auto-create defaults.
export async function ensureTopic() {
  const admin = kafka.admin();
  await admin.connect();
  try {
    // Checking first avoids kafkajs logging "Topic creation errors" on every restart.
    if (!(await admin.listTopics()).includes(ORDER_PLACED_TOPIC)) {
      await admin.createTopics({ topics: [{ topic: ORDER_PLACED_TOPIC, numPartitions: 1 }] });
    }
  } finally {
    await admin.disconnect();
  }
}

export async function publishOrderPlaced(order: Order) {
  const event = toOrderPlacedEvent(order);
  await producer.send({
    topic: ORDER_PLACED_TOPIC,
    // Keyed by order so every event for one order stays in order on one partition.
    messages: [{ key: order.id, value: JSON.stringify(event) }],
  });
}

export async function startFulfillmentConsumer(groupId = "orders-fulfillment") {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  // fromBeginning only applies before the group has committed an offset.
  await consumer.subscribe({ topic: ORDER_PLACED_TOPIC, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ partition, message }) => {
      const where = `partition=${partition} offset=${message.offset} key=${message.key?.toString()}`;
      try {
        const { outcome, orderId, eventId } = handleOrderPlaced(message.value?.toString());
        const line = `[fulfillment] ${outcome} order=${orderId ?? "-"} event=${eventId ?? "-"} ${where}`;
        if (outcome === "confirmed" || outcome === "rejected") console.log(line);
        else console.warn(line);
      } catch (err) {
        // A bug must not wedge the partition; log it and move on (DLQ is a follow-up).
        console.error(`[fulfillment] error ${where}`, err);
      }
    },
  });
  return consumer;
}
