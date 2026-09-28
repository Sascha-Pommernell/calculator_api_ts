import express from "express";
import { calculatorRouter } from "./routes/calculator.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

app.use("/api/calculate", calculatorRouter);

app.use(notFoundHandler);
app.use(errorHandler);
