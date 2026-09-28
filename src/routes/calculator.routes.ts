import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { operations } from "../services/calculator.service.js";
import { OPERATIONS } from "../types/calculator.types.js";
import type { ErrorResponse, Operation } from "../types/calculator.types.js";
import { VALIDATION_ERROR, isCalculationRequest } from "../validation/calculator.validation.js";

export const calculatorRouter = Router();

function createHandler(operation: Operation) {
    const calculate = operations[operation];

    return (req: Request, res: Response<ErrorResponse | string>, next: NextFunction): void => {
        if (!isCalculationRequest(req.body)) {
            res.status(400).json({ error: VALIDATION_ERROR });
            return;
        }

        const { a, b } = req.body;
        try {
            const result = calculate(a, b);
            // Hand-built JSON: JSON.stringify would round the result to double precision.
            res.status(200)
                .type("application/json")
                .send(`{"operation":"${operation}","a":${a},"b":${b},"result":${result.toString()}}`);
        } catch (err) {
            next(err);
        }
    };
}

for (const operation of OPERATIONS) {
    calculatorRouter.post(`/${operation}`, createHandler(operation));
}
