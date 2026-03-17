import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { Header, Footer } from "@/components";

export const metadata: Metadata = {
  title: "Pipi Shrimp Agent - Your Intelligent AI Assistant for macOS",
  description:
    "A powerful, elegant AI assistant that helps you get things done. Built for developers and power users.",
  keywords: ["AI", "assistant", "macOS", "developer", "productivity"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased overflow-x-hidden" suppressHydrationWarning>
        <LanguageProvider>
          <Header />
          <main className="main-content-padding">{children}</main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
