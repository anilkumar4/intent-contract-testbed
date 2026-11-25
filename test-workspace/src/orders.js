import { applyDiscount, calculateSubtotal } from "./pricing.js";

export function createOrder(items, discountPercent = 0) {
  const subtotalCents = calculateSubtotal(items);

  return {
    items: items.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice })),
    subtotalCents,
    discountPercent,
    totalCents: applyDiscount(subtotalCents, discountPercent)
  };
}

export function calculateTax(order) {
  return Math.round(order.subtotalCents * 0.08);
}
