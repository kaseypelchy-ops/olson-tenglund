import { adminHandler } from "@/lib/inventory/server";
import { reviewSupplierCatalog } from "@/lib/inventory/supplier-catalog";
export async function POST(request: Request) { return adminHandler(request, () => reviewSupplierCatalog(request), true); }
