import type { Metadata } from "next";
import InventoryWorkspace from "./inventory-workspace";
import { requireAdminPage } from "@/lib/auth";
import { InventoryError } from "@/lib/inventory/validation";
import { AuthUnavailable } from "../login/auth-shell";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inventory Workspace | Olson & Tenglund, Inc.",
  description: "Manage the Olson & Tenglund parts catalog, vehicle applications, inventory and trade pricing.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  try {
    const user = await requireAdminPage();
    return <InventoryWorkspace staffName={user.name} />;
  } catch (error) {
    if (error instanceof InventoryError && error.status === 503) return <AuthUnavailable setup={error.code === "auth_not_configured"} />;
    throw error;
  }
}
