import { apiHandler, publicVehicles } from "@/lib/inventory/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return apiHandler(request, () => publicVehicles(request)); }
