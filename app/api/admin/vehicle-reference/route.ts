import { adminHandler } from "@/lib/inventory/server";
import { importVehicleReferenceBatch, listVehicleReferences } from "@/lib/inventory/vehicle-reference";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return adminHandler(request, () => listVehicleReferences(request)); }
export async function POST(request: Request) { return adminHandler(request, () => importVehicleReferenceBatch(request), true); }
