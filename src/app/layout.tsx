import type { Metadata } from "next";
import "./globals.css";
import { AntdProvider } from "@/components/common/AntdProvider";

export const metadata: Metadata = {
  title: "Recover | Circularity Decision Workbench",
  description: "Enterprise Aftermarket & Circularity Decision Intelligence Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#F8F9FA] text-[#242424] font-sans">
        <AntdProvider>{children}</AntdProvider>
      </body>
    </html>
  );
}
