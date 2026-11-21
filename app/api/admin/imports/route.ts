import { listImportHistory } from "@/lib/inventory/imports";
import { adminHandler } from "@/lib/inventory/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return adminHandler(request, () => listImportHistory());
}
