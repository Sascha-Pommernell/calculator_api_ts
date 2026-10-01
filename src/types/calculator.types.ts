import type { Decimal } from "decimal.js";

export const OPERATIONS = ["add", "subtract", "multiply", "divide"] as const;

export type Operation = (typeof OPERATIONS)[number];

export type BinaryOperation = (a: Decimal.Value, b: Decimal.Value, ...rest: Decimal.Value[]) => Decimal;

export interface CalculationRequest {
    a: number;
    b: number;
}

export interface CalculationResponse extends CalculationRequest {
    operation: Operation;
    result: number;
}

export interface ErrorResponse {
    error: string;
}
