import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const v3Pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "password",
  database: process.env.PG_DB || "porza_mobile",
  port: Number(process.env.PG_PORT || 5432),
});

export default v3Pool;
