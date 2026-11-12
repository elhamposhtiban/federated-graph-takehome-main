import type { Money } from "./domain.js";

export interface ProductPrice {
  id: string;
  price: Money;
}

const PRODUCTS_URL = process.env.PRODUCTS_URL ?? "http://localhost:4001/graphql";

// Only placeOrder may call this; queries read products through federation.
// Returns null when the product doesn't exist and throws when products can't answer.
export async function fetchProductPrice(id: string): Promise<ProductPrice | null> {
  const res = await fetch(PRODUCTS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "query ($id: ID!) { product(id: $id) { id price { amount currency } } }",
      variables: { id },
    }),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`products responded ${res.status}`);

  const body = (await res.json()) as {
    data?: { product: ProductPrice | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length || !body.data) {
    throw new Error(body.errors?.[0]?.message ?? "products returned no data");
  }
  return body.data.product;
}
