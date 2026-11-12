import { gql } from "graphql-tag";

export const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.11"
      import: ["@key", "@shareable"]
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
    name: String!
    price: Money!
    category: String!

    # Placeholder. The storefront needed this field before an orders service
    # existed, so it returns 0 for now. The orders team is taking ownership
    # of it from their own subgraph.
    orderCount: Int!
  }

  type Query {
    products: [Product!]!
    product(id: ID!): Product
  }
`;
