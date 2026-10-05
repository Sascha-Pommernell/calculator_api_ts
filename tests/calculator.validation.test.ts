import { describe, expect, it } from "vitest";
import { isCalculationRequest } from "../src/validation/calculator.validation.js";

describe("calculator.validation – isCalculationRequest", () => {
    describe("valid requests", () => {
        it.each([
            ["two integers", { numbers: [1, 2] }],
            ["negative and decimal", { numbers: [-5, 2.5] }],
            ["zero operands", { numbers: [0, 0] }],
            ["variadic operands (TC-ADD-02)", { numbers: [1, 2, 3, 4] }],
            ["TC-CON-05: extra fields are tolerated", { numbers: [1, 2], extra: true }],
            ["values at the decimal range limit (7e28)", { numbers: [7e28, -7e28] }],
        ])("accepts %s", (_label, body) => {
            expect(isCalculationRequest(body)).toBe(true);
        });
    });

    describe("4.4 Eingabevalidierung – invalid requests", () => {
        it.each([
            ["TC-VAL-01: only one operand", { numbers: [42] }],
            ["TC-VAL-03: empty object", {}],
            ["TC-VAL-04: undefined body", undefined],
            ["null body", null],
            ["TC-VAL-02: array body", [1, 2]],
            ["string body", "1"],
            ["TC-VAL-05: string operand", { numbers: [1, "abc"] }],
            ["numeric string operand", { numbers: ["1", 2] }],
            ["TC-VAL-07: null operand", { numbers: [1, null] }],
            ["boolean operand", { numbers: [true, 1] }],
            ["NaN operand", { numbers: [Number.NaN, 1] }],
            ["Infinity operand", { numbers: [1, Number.POSITIVE_INFINITY] }],
            ["TC-VAL-10: 1e308 exceeds decimal range", { numbers: [1e308, 1] }],
            ["TC-VAL-11: decimal.MaxValue + 1 exceeds decimal range", { numbers: [79228162514264337593543950336, 1] }],
            ["negative value below decimal.MinValue", { numbers: [-1e29, 1] }],
            ["TC-VAL-12: numbers is not an array", { numbers: 5 }],
            ["TC-VAL-13: legacy two-operand body { a, b }", { a: 1, b: 2 }],
            ["TC-VAL-14: empty numbers array", { numbers: [] }],
            ["invalid operand at a later position", { numbers: [1, 2, "3"] }],
        ])("rejects %s", (_label, body) => {
            expect(isCalculationRequest(body)).toBe(false);
        });
    });
});
