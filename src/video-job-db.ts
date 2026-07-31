import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to check video job status");
  }

  pool ??= new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return pool;
}

export function isVideoJobDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function isVideoJobActive(videoJobId: string): Promise<boolean> {
  if (!isVideoJobDbConfigured()) {
    return true;
  }

  const result = await getPool().query(
    `
    SELECT id
    FROM "VideoJob"
    WHERE id = $1
    LIMIT 1
    `,
    [videoJobId],
  );

  return (result.rowCount ?? 0) > 0;
}
