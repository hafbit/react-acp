const primitiveErrorMessage = (value: bigint | boolean | number | string | symbol): string =>
  typeof value === "symbol" ? (value.description ?? "Symbol") : String(value);

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "bigint" ||
    typeof error === "boolean" ||
    typeof error === "number" ||
    typeof error === "string" ||
    typeof error === "symbol"
  ) {
    return primitiveErrorMessage(error);
  }
  if (error === null) return "null";
  if (error === undefined) return "undefined";

  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(errorMessage(error));
