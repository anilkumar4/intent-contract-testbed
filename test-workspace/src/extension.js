import { evaluateIntent } from "./detectors.js";
import { hasRequiredIntent } from "./contract.js";

export function runIntentChecks(contract) {
  return hasRequiredIntent(contract) ? [] : evaluateIntent(contract);
}
