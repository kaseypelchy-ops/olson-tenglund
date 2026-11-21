import { adminHandler, listRecords, createRecord, updateRecord } from "@/lib/inventory/server";
export async function GET(request: Request) { return adminHandler(request, () => listRecords(request)); }
export async function POST(request: Request) { return adminHandler(request, () => createRecord(request), true); }
export async function PUT(request: Request) { return adminHandler(request, () => updateRecord(request), true); }
