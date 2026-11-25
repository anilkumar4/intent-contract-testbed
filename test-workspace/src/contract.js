export function hasRequiredIntent(contract) {
  return typeof contract.description === "string"
    && contract.description.trim().length > 0
    && Array.isArray(contract.requiredFiles)
    && contract.requiredFiles.length > 0;
}
