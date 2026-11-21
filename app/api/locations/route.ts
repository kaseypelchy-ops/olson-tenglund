import { apiHandler, publicLocations } from "@/lib/inventory/server";
export async function GET(request: Request) { return apiHandler(request, () => publicLocations()); }
