export interface Money {
  amount: number;
  currency: string;
}

export interface Product {
  id: string;
  name: string;
  price: Money;
  category: string;
}

const usd = (amount: number): Money => ({ amount, currency: "USD" });

export const products: Product[] = [
  { id: "1", name: "Wireless Mouse", price: usd(2499), category: "Accessories" },
  { id: "2", name: "Mechanical Keyboard", price: usd(8999), category: "Accessories" },
  { id: "3", name: "27in 4K Monitor", price: usd(34999), category: "Displays" },
  { id: "4", name: "USB-C Dock", price: usd(12950), category: "Accessories" },
  { id: "5", name: "Standing Desk", price: usd(45900), category: "Furniture" },
];
