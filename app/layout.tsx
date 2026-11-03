import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DODAScanner — Verificador de DODA",
  description:
    "Verifica la legalidad de un DODA aduanal a partir de su PDF, Número de Integración o una foto del documento impreso. Gratis, sin registro, de código abierto.",
  keywords: ["DODA", "aduana", "verificador", "QR", "SAT", "México"],
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
