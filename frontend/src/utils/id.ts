let fallbackIdCounter = 0;

export function createClientId(prefix = "id") {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);

  fallbackIdCounter += 1;
  const randomPart = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}-${randomPart}`;
}
