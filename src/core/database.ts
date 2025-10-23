import pg from "pg";

import { appConfig } from "./env.js";

const { Pool } = pg as { Pool: any };

let pool: any = null;

export function getPool(): any {
  if (!pool) {
    pool = new Pool(buildPoolConfig());
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function buildPoolConfig(): any {
  const sslDefault = process.env.NODE_ENV === "production";
  const shouldUseSsl =
    appConfig.dbSsl === undefined ? sslDefault : appConfig.dbSsl;

  if (appConfig.DATABASE_URL) {
    return {
      connectionString: appConfig.DATABASE_URL,
      max: 10,
      ssl: shouldUseSsl
        ? { rejectUnauthorized: false }
        : appConfig.dbSsl === false
        ? false
        : undefined,
    };
  }

  if (appConfig.DB_HOST && appConfig.DB_NAME && appConfig.DB_USER) {
    const config: any = {
      host: appConfig.DB_HOST,
      port: appConfig.DB_PORT ?? 5432,
      database: appConfig.DB_NAME,
      user: appConfig.DB_USER,
      password: appConfig.DB_PASSWORD,
      max: 10,
    };

    if (appConfig.dbSsl !== undefined || sslDefault) {
      config.ssl = shouldUseSsl ? { rejectUnauthorized: false } : false;
    }

    return config;
  }

  throw new Error(
    "Database configuration missing. Provide DATABASE_URL or DB_HOST/DB_NAME/DB_USER variables."
  );
}
