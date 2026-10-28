// Unit tests must fail if they accidentally touch a database.
export * from "../../artifacts/api-server/src/lib/calculator.a1.db-shim";
const forbidden = () => { throw new Error("Database access is forbidden in institutional unit tests"); };
export const pool = { query: forbidden, connect: forbidden };
