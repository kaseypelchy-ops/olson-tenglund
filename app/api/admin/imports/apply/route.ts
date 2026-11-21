import { handleImportApply } from "@/lib/inventory/imports";
import { adminHandler } from "@/lib/inventory/server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return adminHandler(request, () => handleImportApply(request), true);
}
