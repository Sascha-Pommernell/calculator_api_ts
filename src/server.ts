import { app } from "./app.js";

const DEFAULT_PORT = 3000;

function resolvePort(value: string | undefined): number {
    if (value === undefined || value === "") return DEFAULT_PORT;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid PORT: "${value}"`);
    }
    return port;
}

const PORT = resolvePort(process.env["PORT"]);

app.listen(PORT, () => {
    console.log(`Calculator API listening on port ${PORT}`);
});
