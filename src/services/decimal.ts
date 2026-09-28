import { Decimal } from "decimal.js";

// Mirrors System.Decimal: 29 significant digits (MaxValue has 29), max. 28 decimal places,
// round half away from zero.
export const CalcDecimal = Decimal.clone({
    precision: 29,
    rounding: Decimal.ROUND_HALF_UP,
    toExpPos: 29,
});

export const DECIMAL_MAX_ABS = new CalcDecimal("79228162514264337593543950335");
export const DECIMAL_MAX_SCALE = 28;

export function isInDecimalRange(value: Decimal): boolean {
    return value.isFinite() && value.abs().lte(DECIMAL_MAX_ABS);
}
