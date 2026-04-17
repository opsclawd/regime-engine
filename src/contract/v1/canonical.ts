const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not support non-finite numbers.");
  }

  const normalized = Object.is(value, -0) ? 0 : value;
  return JSON.stringify(normalized);
};

const canonicalize = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(
    `Canonical JSON only supports plain objects, arrays, primitives, and null. Received ${typeof value}.`
  );
};

export const toCanonicalJson = (value: unknown): string => {
  return canonicalize(value);
};
