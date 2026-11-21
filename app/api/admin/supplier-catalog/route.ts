import { adminHandler } from "@/lib/inventory/server";
import { listSupplierCatalog, importSupplierCatalog } from "@/lib/inventory/supplier-catalog";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return adminHandler(request, () => listSupplierCatalog(request)); }
export async function POST(request: Request) { return adminHandler(request, () => importSupplierCatalog(request), true); }
