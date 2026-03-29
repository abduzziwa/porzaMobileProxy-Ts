import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client } = pkg;

const pgClient = new Client({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "password",
  database: process.env.PG_DB || "porza_mobile",
  port: Number(process.env.PG_PORT || 5432),
});

await pgClient.connect();

export default pgClient;
