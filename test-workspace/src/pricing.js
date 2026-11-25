export function calculateSubtotal(items) {
  if (!Array.isArray(items)) {
    throw new TypeError("Order items must be an array.");
  }

  return items.reduce((subtotal, item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new RangeError("Item quantities must be positive integers.");
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new RangeError("Unit prices must be finite and non-negative.");
    }
    return subtotal + Math.round(item.unitPrice * 100) * item.quantity;
  }, 0);
}

export function applyDiscount(subtotalCents, discountPercent = 0) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError("Subtotal must be a non-negative integer number of cents.");
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new RangeError("Discount must be a whole percentage from 0 to 100.");
  }

  return Math.round(subtotalCents * (100 - discountPercent) / 100);
}
