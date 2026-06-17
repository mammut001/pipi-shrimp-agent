import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { Header, Footer } from "@/components";
import { getServerLanguage } from "@/lib/serverLanguage";

export const metadata: Metadata = {
  title: "Pipi Shrimp Agent - Your Intelligent AI Assistant for macOS",
  description:
    "A powerful, elegant AI assistant that helps you get things done. Built for developers and power users.",
  keywords: ["AI", "assistant", "macOS", "developer", "productivity"],
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the visitor's saved language once on the server so the very
  // first paint already uses the right translation. The cookie is the
  // single source of truth — there is no localStorage hydration
  // flicker.
  const initialLanguage = await getServerLanguage();

  return (
    <html lang={initialLanguage} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
        >
          Skip to main content
        </a>
        <LanguageProvider initialLanguage={initialLanguage}>
          <div className="app-shell">
            <Header />
            <main id="main" className="app-main" tabIndex={-1}>
              {children}
            </main>
            <Footer language={initialLanguage} />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
