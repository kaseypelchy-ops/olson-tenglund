import { adminHandler, getRecord } from "@/lib/inventory/server";
export async function GET(request: Request) { return adminHandler(request, () => getRecord(request)); }
