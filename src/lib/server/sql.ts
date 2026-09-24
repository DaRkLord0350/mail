import { Prisma } from "@prisma/client";

// Raw SQL must be schema-qualified: with `pgbouncer=true` Prisma does not set
// search_path, so unqualified "EmailDelivery" would fail. The schema comes
// from `?schema=` in DATABASE_URL (Prisma's own convention), default "public".
function resolveSchema(): string {
  const url = process.env.DATABASE_URL ?? "";
  let schema = "public";
  try {
    schema = new URL(url).searchParams.get("schema") || "public";
  } catch {
    /* keep default */
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Unsafe schema name in DATABASE_URL: ${schema}`);
  return schema;
}

let cached: string | null = null;
export function dbSchema(): string {
  if (!cached || process.env.NODE_ENV === "test") cached = resolveSchema();
  return cached;
}

/** Schema-qualified, quoted identifier for raw queries, e.g. t("EmailDelivery"). */
export function t(table: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`Bad table name ${table}`);
  return Prisma.raw(`"${dbSchema()}"."${table}"`);
}

/** Schema-qualified enum type for casts, e.g. `${enumType("DeliveryStatus")}`. */
export function enumType(name: string): Prisma.Sql {
  return t(name);
}
