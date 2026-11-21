import { adminHandler, bootstrap } from "@/lib/inventory/server";
export async function GET(request: Request) { return adminHandler(request, bootstrap); }
