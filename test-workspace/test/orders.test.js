import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDiscount, calculateSubtotal } from "../src/pricing.js";
import { calculateTax, createOrder } from "../src/orders.js";

test("calculates a subtotal from item quantities and prices", () => {
  assert.equal(calculateSubtotal([
    { sku: "tea", quantity: 2, unitPrice: 3.25 },
    { sku: "cup", quantity: 1, unitPrice: 4.5 }
  ]), 1100);
});

test("rejects invalid quantities and discounts", () => {
  assert.throws(() => calculateSubtotal([{ sku: "tea", quantity: 0, unitPrice: 3.25 }]), RangeError);
  assert.throws(() => applyDiscount(1000, 101), RangeError);
});

test("creates an order with a discounted total in cents", () => {
  assert.deepEqual(createOrder([
    { sku: "tea", quantity: 2, unitPrice: 3.25 },
    { sku: "cup", quantity: 1, unitPrice: 4.5 }
  ], 10), {
    items: [
      { sku: "tea", quantity: 2, unitPrice: 3.25 },
      { sku: "cup", quantity: 1, unitPrice: 4.5 }
    ],
    subtotalCents: 1100,
    discountPercent: 10,
    totalCents: 990
  });
});

test("calculates tax from the pre-discount subtotal", () => {
  assert.equal(calculateTax({ subtotalCents: 1100 }), 88);
});
