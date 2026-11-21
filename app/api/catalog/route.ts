import { apiHandler, publicCatalog } from "@/lib/inventory/server";
export async function GET(request: Request) { return apiHandler(request, () => publicCatalog(request)); }
