import type { NextFunction, Request, Response } from "express";
import { CalculationError } from "../services/calculator.service.js";
import type { ErrorResponse } from "../types/calculator.types.js";

export function notFoundHandler(_req: Request, res: Response<ErrorResponse>): void {
    res.status(404).json({ error: "Not found" });
}

export function errorHandler(
    err: unknown,
    _req: Request,
    res: Response<ErrorResponse>,
    _next: NextFunction,
): void {
    if (err instanceof CalculationError) {
        res.status(400).json({ error: err.message });
        return;
    }

    // body-parser errors (invalid JSON, payload too large) carry an HTTP status
    if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
        res.status(err.status).json({ error: err.status === 400 ? "Invalid JSON body" : "Request rejected" });
        return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
}
