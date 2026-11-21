import { apiHandler } from "@/lib/inventory/server";
import { listVehicleReferences } from "@/lib/inventory/vehicle-reference";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return apiHandler(request, () => listVehicleReferences(request)); }
