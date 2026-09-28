import { describe, expect, it } from "vitest";
import {
    add,
    CalculationError,
    divide,
    DivisionByZeroError,
    multiply,
    operations,
    OverflowError,
    subtract,
} from "../src/services/calculator.service.js";
import { DECIMAL_MAX_ABS } from "../src/services/decimal.js";
import { OPERATIONS } from "../src/types/calculator.types.js";

const MAX = DECIMAL_MAX_ABS.toString();
const MIN = `-${MAX}`;

describe("calculator.service", () => {
    describe("4.1 Happy Path – Grundrechenarten", () => {
        it.each([
            ["TC-ADD-01", "add", 1, 2, "3"],
            ["TC-ADD-03", "add", -5, 2.5, "-2.5"],
            ["TC-SUB-01", "subtract", 10, 4, "6"],
            ["TC-SUB-03", "subtract", -1, -1, "0"],
            ["TC-MUL-01", "multiply", 3, 4, "12"],
            ["TC-MUL-03", "multiply", 5, 0, "0"],
            ["TC-MUL-04", "multiply", -2, 2.5, "-5"],
            ["TC-DIV-01", "divide", 10, 4, "2.5"],
            ["TC-DIV-03", "divide", -9, 3, "-3"],
            ["TC-DIV-04", "divide", 0, 5, "0"],
        ] as const)("%s: %s(%d, %d) = %s", (_id, op, a, b, expected) => {
            expect(operations[op](a, b).toString()).toBe(expected);
        });
    });

    describe("4.2 Dezimal-Randfälle – Präzision", () => {
        it("TC-DEC-01: 0.1 + 0.2 is exactly 0.3", () => {
            expect(add(0.1, 0.2).toString()).toBe("0.3");
        });

        it("TC-DEC-02: 1 - 0.9 is exactly 0.1", () => {
            expect(subtract(1, 0.9).toString()).toBe("0.1");
        });

        it("TC-DEC-03: 1.1 * 1.1 is exactly 1.21", () => {
            expect(multiply(1.1, 1.1).toString()).toBe("1.21");
        });

        it("TC-DEC-04: 1 / 3 yields 28 significant digits", () => {
            expect(divide(1, 3).toString()).toBe("0.3333333333333333333333333333");
        });

        it("rounds half away from zero at the 28th digit (2 / 3)", () => {
            expect(divide(2, 3).toString()).toBe("0.6666666666666666666666666667");
        });
    });

    describe("4.2 Dezimal-Randfälle – Überlauf", () => {
        it("TC-DEC-05: decimal.MaxValue + 1 overflows", () => {
            expect(() => add(MAX, 1)).toThrow(OverflowError);
        });

        it("TC-DEC-06: decimal.MinValue - 1 overflows", () => {
            expect(() => subtract(MIN, 1)).toThrow(OverflowError);
        });

        it("TC-DEC-07: 1e15 * 1e15 overflows", () => {
            expect(() => multiply(1e15, 1e15)).toThrow(OverflowError);
        });

        it("TC-DEC-08: decimal.MaxValue / 0.5 overflows", () => {
            expect(() => divide(MAX, 0.5)).toThrow(OverflowError);
        });

        it("accepts results exactly at the range limits", () => {
            expect(add(MAX, 0).toString()).toBe(MAX);
            expect(subtract(MIN, 0).toString()).toBe(MIN);
        });

        it("OverflowError is a CalculationError", () => {
            expect(new OverflowError()).toBeInstanceOf(CalculationError);
        });
    });

    describe("4.3 Division durch null", () => {
        it.each([
            ["TC-DIV0-01", 10, 0],
            ["TC-DIV0-02", 10, -0],
            ["zero as string", 10, "0.0"],
        ])("%s: divide(%d, %s) throws DivisionByZeroError", (_id, a, b) => {
            expect(() => divide(a, b)).toThrow(DivisionByZeroError);
            expect(() => divide(a, b)).toThrow("Division by zero is not allowed");
        });

        it("DivisionByZeroError is a CalculationError", () => {
            expect(new DivisionByZeroError()).toBeInstanceOf(CalculationError);
        });
    });

    it("exposes every operation in the operations map", () => {
        expect(Object.keys(operations).toSorted()).toEqual([...OPERATIONS].toSorted());
    });
});
