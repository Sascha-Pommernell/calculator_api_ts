import { describe, expect, it } from "vitest";
import { isCalculationRequest } from "../src/validation/calculator.validation.js";

describe("calculator.validation – isCalculationRequest", () => {
    describe("valid requests", () => {
        it.each([
            ["integers", { a: 1, b: 2 }],
            ["negative and decimal", { a: -5, b: 2.5 }],
            ["zero operands", { a: 0, b: 0 }],
            ["TC-CON-05: extra fields are tolerated", { a: 1, b: 2, extra: true }],
            ["values at the decimal range limit (7e28)", { a: 7e28, b: -7e28 }],
        ])("accepts %s", (_label, body) => {
            expect(isCalculationRequest(body)).toBe(true);
        });
    });

    describe("4.4 Eingabevalidierung – invalid requests", () => {
        it.each([
            ["TC-VAL-01: only one operand", { a: 42 }],
            ["TC-VAL-03: empty object", {}],
            ["TC-VAL-04: undefined body", undefined],
            ["null body", null],
            ["array body", [1, 2]],
            ["string body", "1"],
            ["TC-VAL-05: string operand", { a: 1, b: "abc" }],
            ["numeric string operand", { a: "1", b: 2 }],
            ["TC-VAL-07: null operand", { a: 1, b: null }],
            ["boolean operand", { a: true, b: 1 }],
            ["NaN operand", { a: Number.NaN, b: 1 }],
            ["Infinity operand", { a: 1, b: Number.POSITIVE_INFINITY }],
            ["TC-VAL-10: 1e308 exceeds decimal range", { a: 1e308, b: 1 }],
            ["TC-VAL-11: decimal.MaxValue + 1 exceeds decimal range", { a: 79228162514264337593543950336, b: 1 }],
            ["negative value below decimal.MinValue", { a: -1e29, b: 1 }],
        ])("rejects %s", (_label, body) => {
            expect(isCalculationRequest(body)).toBe(false);
        });
    });
});
