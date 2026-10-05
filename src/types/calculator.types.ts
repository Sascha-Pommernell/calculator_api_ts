import type { Decimal } from "decimal.js";

export const OPERATIONS = ["add", "subtract", "multiply", "divide"] as const;

export type Operation = (typeof OPERATIONS)[number];

export type BinaryOperation = (a: Decimal.Value, b: Decimal.Value, ...rest: Decimal.Value[]) => Decimal;

/** The HTTP interface requires at least two operands (mirrors the service signature `a, b, ...rest`). */
export const MIN_OPERANDS = 2;

/** At least two operands; evaluated left-associatively by the service. */
export type Operands = [number, number, ...number[]];

export interface CalculationRequest {
    numbers: Operands;
}

export interface CalculationResponse extends CalculationRequest {
    operation: Operation;
    result: number;
}

export interface ErrorResponse {
    error: string;
}
