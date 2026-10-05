import { CalcDecimal, isInDecimalRange } from "../services/decimal.js";
import { MIN_OPERANDS } from "../types/calculator.types.js";
import type { CalculationRequest } from "../types/calculator.types.js";

export const VALIDATION_ERROR =
    "Body must contain an array numbers with at least two finite numbers within the decimal range";

const isDecimalNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && isInDecimalRange(new CalcDecimal(value));

export function isCalculationRequest(body: unknown): body is CalculationRequest {
    if (typeof body !== "object" || body === null || Array.isArray(body)) return false;

    const { numbers } = body as Record<string, unknown>;
    return Array.isArray(numbers) && numbers.length >= MIN_OPERANDS && numbers.every(isDecimalNumber);
}
