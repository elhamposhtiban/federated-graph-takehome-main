import { gql } from "graphql-tag";

export const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.11"
      import: ["@key", "@shareable", "@override"]
    )

  # Copied verbatim from products: shared value types must match exactly to compose.
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
    # Nullable so an outage in products doesn't null out the whole order.
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
`;
