import { hasRequiredIntent } from "./contract.js";

export function evaluateIntent(contract) {
  return hasRequiredIntent(contract)
    ? []
    : ["Intent description and required files must be provided."];
}
