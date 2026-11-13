# NOTES

## Running it

```bash
npm install
npm run kafka:up      # Kafka on :9092, Kafka UI on :8080
npm run dev:orders    # start orders first (:4002)
npm run dev           # products (:4001) + gateway (:4000)
npm test              # no services needed; KAFKA_TESTS=1 npm test also runs the Kafka test
```

Start orders before the gateway. The gateway composes once at startup, so restart it after any
schema change.

I built items 1–6, 8 and 9. I designed item 7 but didn't build it (reason below).

## Schema

```graphql
extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.11"
    import: ["@key", "@shareable", "@override", "@external", "@requires"]
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
  # Owned by products; declared only so revenue can @require it.
  price: Money! @external
  "Confirmed quantity at the current catalog price. Computed per request, never stored."
  revenue: Money! @requires(fields: "price { amount currency }")
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

`placeOrder` returns the order in `PLACED`. The result (confirmed or rejected) comes later, so the client asks `order(id)` again.

Errors are normal GraphQL errors with a code:

- `BAD_USER_INPUT`: quantity below 1. GraphQL's `Int` already rejects values like 2.5.
- `PRODUCT_NOT_FOUND`: products says the id doesn't exist.
- `PRODUCTS_UNAVAILABLE`: products didn't answer. I kept this separate from "not found" so an
  outage never tells a customer that a real product doesn't exist.
- `ORDER_NOT_PLACED`: publishing to Kafka failed. The order is removed and the client can retry.

An order for more than 10 is accepted as `PLACED`. Rejecting it is fulfillment's decision, not
the mutation's.

I considered a result union (`OrderPlaced | ProductNotFound | ...`) so errors show up in the
schema. I didn't use it: it doesn't fit the README's `placeOrder { id status }` example, and
outages would still need top-level errors. I'd revisit it if clients wanted typed errors.

### How I learn the price paid, and where it's stored

Orders doesn't own prices and can't trust a price from the client, so `placeOrder` asks the
products subgraph for `product(id) { price }`. That is the only HTTP call orders makes to
products, and it only happens in the mutation. I call products directly (`PRODUCTS_URL`) rather than through the gateway, to avoid a gateway → orders → gateway loop.

The price is copied onto the order as `unitPricePaid` and never updated, like a receipt.

### Order status

`PLACED` → `CONFIRMED` or `REJECTED`. Only `PLACED` can change; the other two are final. That one rule is what makes duplicate events harmless.

Fulfillment rejects quantities over 10 and confirms the rest. In a real system this would be a
stock check.

### Rejected orders in lists, and long lists (item 7, not built)

I skipped this to keep time for items 1–4. It's mostly pagination and filtering, with nothing new on the Kafka or federation side.

How I'd build it: `Product.orders(first: Int = 20, after: String, status: [OrderStatus!])`
returning a connection. Rejected orders hidden by default, with `status` to include them. The
cursor would be `(placedAt, id)` so pages stay stable, backed by an index per product instead of scanning every order.

### Event shape

One topic, `orders.order-placed`, with one partition. The message key is the order id, so all
events for an order land on the same partition and stay in order.

```json
{
  "eventId": "uuid",
  "eventType": "OrderPlaced",
  "version": 1,
  "occurredAt": "2026-11-12T10:00:00.000Z",
  "data": {
    "orderId": "uuid",
    "productId": "1",
    "quantity": 2,
    "unitPricePaid": { "amount": 2499, "currency": "USD" }
  }
}
```

`eventId` makes duplicates easy to spot in logs. `version` lets a consumer tell old and new shapes apart if the event changes. The price paid is included so other consumers, like billing, don't have to call back for it.

The consumer (group `orders-fulfillment`) runs inside the orders process, because the orders it settles live in that process's memory. In production it would be its own service on a shared database.

### Duplicate delivery

Kafka delivers at least once. If the consumer crashes after handling a message but before
committing its offset, it gets that message again.

- Fulfillment only settles orders that are still `PLACED`. A redelivered event finds the order
  already settled and does nothing.
- `orderCount` is counted from order state, not kept as a running counter, so nothing can be
  added twice.
- Order ids are UUIDs, so an old event can't match a new order after a restart.
- Messages I can't use (bad JSON, unknown version, missing fields, an order I don't have) are
  logged and skipped. The handler never throws, because a throw makes kafkajs retry the same
  message forever and block everything behind it.

The trade-off: a skipped message is gone apart from its log line. A dead-letter topic would fix that (follow-up 3).

To replay a duplicate by hand, read a message back out and send it again unchanged:

```bash
docker exec takehome-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic orders.order-placed --partition 0 --offset N --max-messages 1 \
  --property print.key=true --property key.separator='|' > dup.txt
docker exec -i takehome-kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 \
  --topic orders.order-placed --property parse.key=true --property key.separator='|' < dup.txt
```

The orders log shows `duplicate`, and `orderCount` doesn't change.

### Other decisions

**Save, then publish.** If I published first, a fast consumer could see an event for an order
that isn't saved yet. If the publish fails, I delete the order and return `ORDER_NOT_PLACED`.
One edge case: if Kafka stores the event but its acknowledgement times out, I delete an order
that was actually published. The consumer then skips that event as an unknown order and the
client's retry creates a fresh one, so nothing breaks, but it's the reason a transactional outbox
is the real fix (follow-up 2).

**`Order.product` is nullable.** Orders stores only `productId` and returns a reference; the
gateway gets `name` and `category` from products. If products is down, the client still gets the order's status and price paid, with `product: null`. With `Product!`, the whole order would come back null.

**Taking over `orderCount`.** Orders declares `orderCount: Int! @override(from: "products")`. The gateway now asks orders for it. Products' placeholder is still there; it just isn't called. Only confirmed orders count, and a product with no orders still returns 0, so the storefront sees no change at the switch.

**Revenue (item 6).** Orders declares `price` as `@external` and `revenue` with
`@requires(fields: "price { amount currency }")`. The gateway fetches the current price from
products and passes it in with each request; orders multiplies it by the confirmed quantity and keeps nothing. If the catalog price changes, the next query reflects it. This assumes one currency per product, which is how products models prices today.

## Composition errors

Before writing orders, I composed draft schemas against products offline with
`@apollo/composition` (the gateway's version). I hit these three errors there, so the real build composed cleanly. Adding `@requires` for revenue later also composed on the first try.

1. **`orderCount` without `@override`**
   `INVALID_FIELD_SHARING: Non-shareable field "Product.orderCount" is resolved from multiple subgraphs`.
   Only one subgraph may resolve a field. Fixed with `@override(from: "products")`. `@shareable` would have needed a change in products and let the gateway pick either answer (0 or the real count).

2. **`Money` without `@shareable`**
   `INVALID_FIELD_SHARING: Non-shareable field "Money.amount" is resolved from multiple subgraphs`
   (same for `currency`). Every subgraph that declares a shared value type has to mark it. Fixed with `type Money @shareable`.

3. **`Money` with a different field type**
   `FIELD_TYPE_MISMATCH: Type of field "Money.amount" is incompatible across subgraphs: it has type "Float!" in subgraph "orders" but type "Int!" in subgraph "products"`. Fixed by copying products' `Money` exactly. I copied the description too: a different one still composes, but the supergraph can end up showing orders' wording on products' type.

Composition also gives a hint, `OVERRIDDEN_FIELD_CAN_BE_REMOVED`, for products' old `orderCount`. That one is theirs to act on.

## Asks for the products team

- Remove the `orderCount` placeholder field and resolver. Orders serves it now.
- Stock. Products has no inventory, so placing an order reserves nothing. Fulfillment should
  check and reserve stock with whoever owns it, instead of using the "over 10" rule.

## Tests

`npm test` runs 23 tests with `node:test`, with no services needed. `KAFKA_TESTS=1 npm test` adds
one test against real Kafka.

What they cover:

- The settlement rule (10 confirms, 11 rejects), and that settled orders never change.
- The consumer, fed raw messages: the same message twice settles and counts once; unknown orders and a dozen kinds of bad message are skipped without throwing.
- `placeOrder` with fake products and Kafka: every error code, no order left behind when
  publishing fails, and the price paid not moving when the catalog price changes.
- `order(id)`, `Order.product`, `orderCount` and `revenue`, through the same `_entities` call the gateway makes.
- Composition against products' real schema file: no errors, `orderCount` routed to orders,
  `revenue` requiring `price`.
- Real Kafka (opt-in): the same message sent twice is settled and counted once.

To check the tests catch real bugs, I broke the code on purpose (removed the `PLACED` check,
changed `> 10` to `>= 10`, dropped the price copy). The right tests failed each time.

Not covered: the full flow across all three services (I checked that by hand), restarts and
consumer rebalancing, and performance.

## Follow-ups (rough priority)

1. A real database. A restart currently loses every order.
2. Transactional outbox instead of save, publish, undo.
3. Dead-letter topic for skipped messages.
4. Real stock reservation instead of the "over 10" rule.
5. Tell the client when an order settles (subscription or notification) instead of polling.
6. Count orders with an indexed query instead of scanning all of them.
7. An automated end-to-end test across all three services.
8. Item 7 (`Product.orders`), as designed above.
9. Progressive `@override` to roll out the next field takeover gradually.
10. Move off kafkajs. It's unmaintained and warns on Node 26 (`TimeoutNegativeWarning`, harmless).

## Something I ran into

Apollo Server handles Ctrl+C itself and kills the process before the Kafka consumer can leave its group. Kafka then keeps a dead consumer for about 30 seconds, and a restarted orders waits for it.
I turned Apollo's handling off (`stopOnTerminationSignals: false`) and shut down Kafka and the
server myself.

## Time spent

About 6 hours over two sessions, which is why item 7 is a design rather than code. Most of the
time went into items 1–4, as the README asks.

## How I used AI

I used Claude Code with Opus 5.5 as a pairing partner. Claude wrote most of the code. My part was
the design decisions, the questions, and reviewing every step before it was committed.

**Kickoff.** I started in plan mode with a prompt structured as ROCC: role, objective, context and constraints. The constraints were the README's hard rules plus how I wanted to work, for example:

> Never edit anything in `products/`. If a change seems needed, stop and tell me.
> Processing a duplicate event must not settle twice, count twice, or crash the consumer.
> Never start the next phase or step without my "next".

**Plan before code.** It explored the repo read-only first, then we went through the design one part at a time before any code was written. The overall design was mine to sign off; the AI filled in gaps and helped me see the whole picture.

**Finding holes.** I kept going back and forth with it, and some of its plan didn't hold up. Two examples: it didn't account for stock at all (products has none, so I made it an ask for the products team), and it had no answer for telling a client to retry when an order fails, which led to undoing the order and returning `ORDER_NOT_PLACED` when Kafka is down.

**Decisions I made** where there was a real trade-off: returning `Order` with error codes instead of a union, a nullable `product`, keeping the README's status names instead of adding `PENDING`, undoing the order when Kafka fails, logging bad events with a dead-letter topic as a follow-up, and building revenue but not item 7.

**Small steps.** I broke the build into nine steps. After each one I read the diff in Cursor,
ran the commands and queries it gave me, and only then committed.

**Making it prove things.** I don't trust an agent's answer just because it sounds right, so I
asked it to prove claims in different ways: running the system, showing the gateway's query
plan, checking Kafka's consumer groups, and breaking the code on purpose to confirm the tests
fail. That process caught real mistakes: it once stated a composition behaviour it hadn't tested,
and its first shutdown code left a dead Kafka consumer behind (see "Something I ran into").

**With more time,** I'd turn this setup into a Claude Code skill for the project: the hard rules, the step-by-step loop and the verification commands. The next session, or a teammate, would then start from the same guardrails instead of a long kickoff prompt.
