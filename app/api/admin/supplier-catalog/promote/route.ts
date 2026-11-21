import { adminHandler } from "@/lib/inventory/server";
import { promoteSupplierCatalog } from "@/lib/inventory/supplier-catalog";
export async function POST(request: Request) { return adminHandler(request, () => promoteSupplierCatalog(request), true); }
