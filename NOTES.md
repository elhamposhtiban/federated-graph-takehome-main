# NOTES

> Draft, updated as each build step lands. Items marked _(planned)_ are designed but not built yet.

## Schema (`orders`)

```graphql
extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.11"
    import: ["@key", "@shareable", "@override"]
  )

"""
An amount of money in one currency. The amount is in the currency's minor
unit, so 24.99 USD is { amount: 2499, currency: "USD" }.
"""
type Money @shareable {
  amount: Int!
  currency: String!
}

type Product @key(fields: "id") {
  id: ID!
  "Number of confirmed orders for this product."
  orderCount: Int! @override(from: "products")
}

enum OrderStatus {
  "Recorded and waiting for fulfillment to decide."
  PLACED
  CONFIRMED
  REJECTED
}

type Order {
  id: ID!
  status: OrderStatus!
  quantity: Int!
  product: Product
  "Unit price at the moment the order was placed; never follows catalog changes."
  unitPricePaid: Money!
  placedAt: String!
}

type Query {
  order(id: ID!): Order
}

type Mutation {
  "Records the order as PLACED; fulfillment settles it asynchronously."
  placeOrder(productId: ID!, quantity: Int!): Order!
}
```

## Decisions

### What `placeOrder` returns, and unknown products
- Returns `Order!` in status `PLACED`. The outcome arrives later; clients re-query `order(id)`.
- Failures are GraphQL errors with `extensions.code`:
  - `BAD_USER_INPUT`: quantity is not a whole number ≥ 1.
  - `PRODUCT_NOT_FOUND`: products returned `null` for the id.
  - `PRODUCTS_UNAVAILABLE`: products could not be reached. Kept separate so an outage is never
    reported to a customer as "this product doesn't exist".
  - `ORDER_NOT_PLACED`: the Kafka publish failed; the saved order is removed (see dual write below).
- Quantity > 10 is **accepted** as `PLACED`. Rejecting it is fulfillment's job; if the mutation did
  it, the mutation would be settling the order.
- Alternative considered: a result union (`OrderPlaced | ProductNotFound | ...`), which makes
  business errors visible in the schema. Not chosen: it doesn't match the README's
  `placeOrder { id status }` shape, infrastructure failures would still need top-level errors,
  and it costs time better spent on items 1-4.

### How we learn the price paid, and where it lives
- `orders` doesn't own products, so `placeOrder` asks the products subgraph directly
  (`PRODUCTS_URL`, default `http://localhost:4001/graphql`) for `product(id) { id price }`.
  This is the only HTTP call to products, and it's in a mutation, as the rules allow.
  Direct rather than via the gateway, to avoid a gateway → orders → gateway loop.
- The client never sends a price. The returned price is copied onto the order as
  `unitPricePaid` and never refreshed, like a receipt.

### Order status
- `PLACED → CONFIRMED` or `PLACED → REJECTED`. Both settled states are final.
- Only `PLACED` can move, which is what makes duplicate events harmless.
- Settlement rule (README item 2): quantity > 10 → `REJECTED`, otherwise `CONFIRMED`. It stands in
  for a real stock check.

### Rejected orders in lists, long lists
- Not built (item 7, optional). Design: cursor pagination (`first`/`after`), rejected orders
  excluded by default with a `status` filter to include them.

### Event shape
- Topic `orders.order-placed`, created at startup with 1 partition. Message key = `orderId`, so all
  events for one order land on the same partition, in order.
- Consumer group `orders-fulfillment` runs in the orders process, because the store it settles is
  in that process's memory. In production it would be its own service writing to a shared database.
- ```json
  {
    "eventId": "uuid",
    "eventType": "OrderPlaced",
    "version": 1,
    "occurredAt": "ISO-8601",
    "data": { "orderId": "uuid", "productId": "1", "quantity": 2,
              "unitPricePaid": { "amount": 2499, "currency": "USD" } }
  }
  ```
- `eventId` is for tracing duplicates in logs; `version` lets consumers tell shapes apart if the
  event changes.

### Duplicate delivery
- Kafka is at-least-once. A crash between processing and committing the offset redelivers the event.
- The consumer (group `orders-fulfillment`) settles only orders still `PLACED`; a redelivered event
  finds the order already settled and does nothing.
- `orderCount` is computed from order state, not a stored counter, so it can't be incremented twice.
- Order ids are UUIDs, so after a restart an old event can't match a new order that reused an id.
- Bad events (malformed, unknown version, unknown order such as one lost in a restart) are logged
  with `eventId`/`orderId` and skipped. The handler never throws, so one bad message can't block
  the partition.
- Every message ends in one of five outcomes: `confirmed`, `rejected` (logged as info) or
  `duplicate`, `unknown-order`, `malformed` (logged as warnings). An unexpected exception is
  logged as an error and skipped, not rethrown.
- Skipping trades a stuck partition for a possibly lost event; a dead-letter topic would keep
  those events for replay (follow-up 3).
- Verified by hand: re-producing a confirmed order's exact message logged `duplicate`, and
  `orderCount` stayed at 1. Non-JSON, `version: 99`, a missing `quantity` and an unknown order id
  were each skipped, and the next real order still settled.

Replaying a duplicate by hand (Kafka running):
```bash
# read the message at offset N back out, with its key
docker exec takehome-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic orders.order-placed --partition 0 --offset N --max-messages 1 \
  --property print.key=true --property key.separator='|' > dup.txt
# produce it again, byte for byte
docker exec -i takehome-kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 \
  --topic orders.order-placed --property parse.key=true --property key.separator='|' < dup.txt
```

### Dual write
- Save the order, then publish. Never the reverse, or a fast consumer could see an event for an
  order that doesn't exist yet.
- If the publish fails, the order is deleted and the client gets `ORDER_NOT_PLACED` ("try again").

## Composition errors
Before writing `orders`, I composed candidate schemas against `products` offline
(`composeServices` from `@apollo/composition` 2.14.4, the gateway's version) to learn the rules,
then designed to pass. The real build composed with zero errors.

1. **`Product.orderCount` declared without `@override`**
   ```
   INVALID_FIELD_SHARING: Non-shareable field "Product.orderCount" is resolved from multiple
   subgraphs: it is resolved from subgraphs "orders" and "products" and defined as non-shareable in all of them
   ```
   - Cause: in Fed 2, only one subgraph may resolve a field unless it's `@shareable`.
   - Fix: `orderCount: Int! @override(from: "products")`. `@shareable` would be wrong: it needs a
     change in products, and both answers (0 and the real count) would count as valid.

2. **`Money` declared without `@shareable`**
   ```
   INVALID_FIELD_SHARING: Non-shareable field "Money.amount" is resolved from multiple subgraphs:
   it is resolved from subgraphs "orders" and "products" and defined as non-shareable in subgraph "orders"
   ```
   (and the same for `Money.currency`)
   - Cause: every subgraph that declares a shared value type must mark it `@shareable`.
   - Fix: `type Money @shareable` in orders.

3. **`Money` with a different field type**
   ```
   FIELD_TYPE_MISMATCH: Type of field "Money.amount" is incompatible across subgraphs: it has type
   "Float!" in subgraph "orders" but type "Int!" in subgraph "products"
   ```
   - Cause: shared value types must match field by field.
   - Fix: copy products' `Money` exactly, including its description, so composition doesn't raise
     an inconsistent-description hint.

**Hint (not an error):** `OVERRIDDEN_FIELD_CAN_BE_REMOVED: Field "Product.orderCount" on subgraph
"products" is overridden.` This is the products team's to act on; see the asks below.
`IntrospectAndCompose` doesn't print hints; this one came from composing the same SDL offline.

**Verified at step 1:** the gateway started cleanly, and its query plan fetches `orderCount` from
`orders` (`Fetch(service: "orders") { ... on Product { orderCount } }`).

## Asks for the products team
- **Remove the `Product.orderCount` placeholder** (field and resolver). `orders` now serves it via
  `@override`; composition flags theirs as `OVERRIDDEN_FIELD_CAN_BE_REMOVED`.
- **Inventory/stock.** Products has no stock data, so placing an order decrements nothing. In a real
  system, fulfillment would reserve stock from whichever service owns inventory. We didn't touch
  products because of the ground rules.

## Tests _(planned, step 7)_
TBD once written. Planned: pure settlement and consumer logic, resolvers with fake products and
Kafka, a composition test, and an opt-in real-Kafka duplicate test (`KAFKA_TESTS=1`).

## Follow-ups (rough priority)
1. Durable storage. Today a restart loses every order, and Kafka events for them become
   "unknown order".
2. Transactional outbox instead of save-then-publish-then-undo.
3. Dead-letter topic for events the consumer skips.
4. Inventory reservation in fulfillment, replacing the "> 10" rule.
5. Push the async outcome to clients (subscription or notification) instead of polling `order(id)`.
6. Indexed counts instead of scanning every order for `orderCount`.
7. Progressive `@override` (`label: "percent(x)"`) to roll out a field takeover safely.
8. Replace kafkajs. 2.2.4 is no longer maintained and prints `TimeoutNegativeWarning` on Node 26
   (harmless). Confluent's `@confluentinc/kafka-javascript` keeps a kafkajs-compatible API.

## Gotchas found while building
- **Apollo Server's signal handling vs. Kafka.** By default Apollo stops itself on SIGINT/SIGTERM
  and then re-sends the signal, killing the process before the consumer leaves its group. Kafka then
  keeps a dead member for ~30s (the session timeout) before rebalancing, so after a `tsx watch`
  restart the new consumer waits. Fixed with `stopOnTerminationSignals: false` and our own
  shutdown that disconnects the consumer and producer and stops the server. Verified with
  `kafka-consumer-groups.sh --describe --members`: no members right after SIGTERM.

## Time spent
_TODO (me)_

## How I used AI
_TODO (me)_
