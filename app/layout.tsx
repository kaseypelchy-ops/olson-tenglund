import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inventory Workspace | Olson & Tenglund, Inc.",
  description: "Product catalog, vehicle applications, and inventory for Olson & Tenglund, Inc. in Coudersport, Port Allegany, and Smethport, Pennsylvania.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/storefront/assets/favicon.svg",
    shortcut: "/storefront/assets/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
