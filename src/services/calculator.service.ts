import type { Decimal } from "decimal.js";
import type { BinaryOperation, Operation } from "../types/calculator.types.js";
import { CalcDecimal, DECIMAL_MAX_SCALE, isInDecimalRange } from "./decimal.js";

export class CalculationError extends Error {}

export class DivisionByZeroError extends CalculationError {
    constructor() {
        super("Division by zero is not allowed");
        this.name = "DivisionByZeroError";
    }
}

export class OverflowError extends CalculationError {
    constructor() {
        super("Arithmetic overflow: result exceeds the decimal range");
        this.name = "OverflowError";
    }
}

function checked(result: Decimal): Decimal {
    if (!isInDecimalRange(result)) throw new OverflowError();
    return result.toDecimalPlaces(DECIMAL_MAX_SCALE);
}

export const add: BinaryOperation = (a, b) => checked(new CalcDecimal(a).plus(b));
export const subtract: BinaryOperation = (a, b) => checked(new CalcDecimal(a).minus(b));
export const multiply: BinaryOperation = (a, b) => checked(new CalcDecimal(a).times(b));

export const divide: BinaryOperation = (a, b) => {
    const divisor = new CalcDecimal(b);
    if (divisor.isZero()) throw new DivisionByZeroError();
    return checked(new CalcDecimal(a).div(divisor));
};

export const operations: Readonly<Record<Operation, BinaryOperation>> = {
    add,
    subtract,
    multiply,
    divide,
};
