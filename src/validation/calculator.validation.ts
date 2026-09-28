import { CalcDecimal, isInDecimalRange } from "../services/decimal.js";
import type { CalculationRequest } from "../types/calculator.types.js";

export const VALIDATION_ERROR = "Body must contain finite numbers a and b within the decimal range";

const isDecimalNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && isInDecimalRange(new CalcDecimal(value));

export function isCalculationRequest(body: unknown): body is CalculationRequest {
    if (typeof body !== "object" || body === null) return false;

    const { a, b } = body as Record<string, unknown>;
    return isDecimalNumber(a) && isDecimalNumber(b);
}
