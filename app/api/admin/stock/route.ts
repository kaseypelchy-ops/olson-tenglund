import { adminHandler, listStock, adjustStock } from "@/lib/inventory/server";
export async function GET(request: Request) { return adminHandler(request, () => listStock(request)); }
export async function POST(request: Request) { return adminHandler(request, () => adjustStock(request), true); }
