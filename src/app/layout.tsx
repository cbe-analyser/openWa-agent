import type { Metadata, Viewport } from "next";
import "./globals.css";

const appName = process.env.APP_NAME ?? "OpenWa Agent";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description:
    "Self-hosted AI customer-support agent for WhatsApp Business. Independent open-source project; not affiliated with WhatsApp or Meta.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
