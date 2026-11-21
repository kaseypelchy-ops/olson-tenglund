import { drizzle } from "drizzle-orm/libsql";
import { getLibsqlClient } from "./connection";
import * as schema from "./schema";

export function getDb() {
  return drizzle(getLibsqlClient(), { schema });
}
