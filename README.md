# Take-home exercise: federated GraphQL and Kafka

## Overview

This repo is a small federated GraphQL graph built on Apollo Federation v2.
It has three packages:

- `products` is already implemented. It belongs to the products team and
  owns the `Product` entity and the `Money` value type.
- `gateway` is already implemented. It composes the subgraphs into one graph.
- `orders` is **your task**. It is only a stub right now, and you will build
  it from scratch.

The `docker-compose.yml` runs a real Apache Kafka broker and a web UI for
inspecting topics, so you can build a real producer and consumer instead of
a mock.

## The situation

You are on the orders team. The storefront wants to place orders and show
order data next to products, and none of that exists yet.

The products team shipped their subgraph months ago. So that the storefront
would not block on you, they added a placeholder `Product.orderCount` field
that always returns 0. Now that you are building `orders`, that field is
yours to take over.

Ground rules:

- **Do not edit `products`.** It belongs to another team, and what they
  expose is what you get. If you think you need a change there, don't make
  it. Write down what you would ask them for and why in `NOTES.md`.
- **Leave `gateway` alone** apart from adding your subgraph to its list.
- **Reads across subgraphs go through the gateway.** A resolver in `orders`
  must not call `products` over HTTP to answer a query. A mutation that needs
  data from another service is a different matter; see item 5 below.
- **Money has one shape.** `products` exposes prices as its `Money` type.
  Anything money-shaped in your schema should be that same type. Clients
  should not see two kinds of money in one graph.
- **The gateway must compose without errors.** Composition errors are part of
  the exercise. Keep a record of the ones you hit and how you got past them.

## Your task

Build `orders`, a new Apollo Federation v2 subgraph. You write the schema,
resolvers, Kafka wiring, and server setup. There is no starter schema, and
apart from the placeholder field you are taking over, nothing below names a
type or field for you to copy. Design it yourself. We will ask you about it.

Here is the storefront team's backlog, in the order they want it:

1. **Place an order.** A client orders a quantity of a product and learns
   whether that worked. It can look the order up again afterwards. Keep
   orders in memory, as `products` does. What the mutation returns, and what
   happens when the product does not exist, are your decisions. Your service
   does not own products, so think about how you would even know.

2. **Settle orders asynchronously.** When an order is placed, publish an
   event to Kafka with [`kafkajs`](https://kafka.js.org/), which is already
   installed. You choose the topic name and event shape. Then write a
   consumer, in its own consumer group, that reads the event and settles
   the order: fulfillment confirms it, unless the quantity is more than 10,
   in which case fulfillment rejects it. The mutation itself should only
   record the initial state and publish the event - it must never settle
   the order itself. An order therefore has at least three states: just
   placed, confirmed, and rejected.

3. **Handle duplicate delivery.** Kafka delivers messages at least once, not
   exactly once. Your consumer can receive the same event more than once.
   Processing it twice must not settle an order twice, count it twice, or
   crash the consumer.

4. **Take over `Product.orderCount`.** Clients need to know how many
   confirmed orders a product has. `products` serves this field as a
   placeholder today. When you are done, the gateway must serve it from
   `orders` with the real count, and `products` must be untouched.

5. **Show the product on an order.** Clients need an order's product, at
   least its name and category, and the unit price the customer paid. That
   price must not change if the catalog price changes later. Your service
   does not own the catalog, and the client cannot be trusted to send you a
   price. How you learn the price and where you keep it is a design
   decision. Write it down.

6. **Show revenue on a product.** Clients need the value of a product's
   confirmed orders at the current catalog price, as `Money`. Merchandising
   uses it to compare list value against what customers paid. `products`
   owns the price. Your service must not store or copy the catalog price to
   compute this.

7. **List a product's orders.** Clients need the orders for a product.
   Whether rejected orders appear, and what happens for a product with
   thousands of orders, are your call.

8. **Add the subgraph to the gateway** in `gateway/src/index.ts`. We suggest
   serving `orders` on port `4002`.

9. **Write tests that show your implementation is correct.** Choose what to
   test and how. Any test runner is fine, including the built-in
   `node:test`. Tests must run with `npm test` from the repo root, so add a
   `test` script to `orders/package.json`. If a test needs Kafka running,
   say so.

### What "done" looks like

Start Kafka, `products`, `orders`, and `gateway`, then work through the
gateway at `localhost:4000`. Your names and shapes will differ from these
examples. The flow is what matters.

Place an order:

```graphql
mutation {
  placeOrder(productId: "1", quantity: 2) {
    id
    status
  }
}
```

After your consumer has processed the event, querying the product reflects
it:

```graphql
query {
  product(id: "1") {
    name
    price { amount currency }
    orderCount
    revenue { amount currency }
  }
}
```

And querying the order shows the product and the price paid, resolved
across both subgraphs in one query:

```graphql
query {
  order(id: "...") {
    status
    unitPricePaid { amount currency }
    product { name category }
  }
}
```

An order for a quantity over 10 ends up rejected and never counts toward
`orderCount` or revenue.

## Getting started

You need Node.js 24 or later (see `.nvmrc`), npm, and Docker Desktop or a
compatible runtime.

```bash
# 1. Install dependencies for every workspace
npm install

# 2. Start Kafka (+ a Kafka UI at http://localhost:8080 for debugging)
npm run kafka:up

# 3. Start products + the gateway
npm run dev

# 4. In a separate terminal, once you've started building orders:
npm run dev:orders

# 5. Run the tests
npm test
```

| Service    | URL                                        |
| ---------- | ------------------------------------------ |
| `products` | http://localhost:4001/graphql              |
| `gateway`  | http://localhost:4000                      |
| Kafka UI   | http://localhost:8080                      |
| `orders`   | Wherever you serve it. We suggest `:4002`. |

## What we look at

We want to see what you prioritize, and how you reason about a schema you
share with another team. There is no single correct implementation, and a
few pieces done well tell us more than every piece done in a hurry.

If you run short on time, pick what matters most, do it properly, and write
down the rest. A clear note that says "I didn't handle X. Here is the risk
and how I would fix it" counts for more than a rushed version of X.

Include a `NOTES.md` at the repo root that covers:

- Your schema. Paste the SDL for `orders`.
- The decisions you made and why. At minimum:
  - What placing an order returns, and what happens when the product does
    not exist.
  - How your service learns the price paid and where it lives.
  - How you modeled order status.
  - Whether rejected orders appear in lists, and how you handle long lists.
  - Your event shape.
  - How you handle duplicate delivery.
- The composition errors you hit and how you resolved each one.
- Anything you would ask the products team for, and why.
- What your tests cover and what they don't.
- Follow-ups: what you left out or would change before production, in
  rough priority order.
- Roughly how long you spent.

## Time limit

Spend no more than 6 hours on this. The backlog is longer than that on
purpose, and we do not expect you to finish it. Items 1 through 4 are the
core flow and should take most of your time. Beyond that, you decide what
to build and how far to go, and you tell us what you skipped and why. We
would rather see where you stopped and what you would do next than a
solution you spent a weekend polishing.

## Submitting

Zip your solution without `node_modules` and send it back the same way you
received it.
