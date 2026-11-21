import { getAuth } from "@/lib/auth";
import { InventoryError } from "@/lib/inventory/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const configured = error instanceof InventoryError && error.code === "auth_not_configured";
    return Response.json({
      code: configured ? "auth_not_configured" : "auth_unavailable",
      message: configured ? "Staff sign-in has not been configured." : "Staff sign-in is temporarily unavailable. Please try again later.",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
