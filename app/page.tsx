import { Suspense } from "react";
import Header from "@/components/Header";
import Scanner from "@/components/Scanner";

export default function HomePage() {
  return (
    <>
      <Header />

      <main className="flex-1 bg-slate-50">
        <div className="max-w-lg mx-auto px-4 py-4 sm:py-10">
          <div className="mb-4 sm:mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              DODAScanner
            </h1>
            <p className="text-slate-500 text-sm">
              Verifica la legalidad de un DODA: escanea su código QR, sube el
              PDF, o sube una foto del documento impreso.
            </p>
          </div>

          <Suspense fallback={<div className="h-64 flex items-center justify-center text-slate-400 text-sm">Cargando escáner…</div>}>
            <Scanner />
          </Suspense>
        </div>
      </main>

      <footer className="border-t border-slate-100 py-6 bg-white">
        <div className="flex flex-col items-center justify-center gap-2 text-xs text-slate-400 text-center px-4">
          <p>
            DODAScanner es una herramienta independiente y de código abierto.
            No es software oficial del SAT.
          </p>
          <a
            href="https://github.com/benjaminascencio10/DODAcheck"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-600 underline underline-offset-2 transition-colors"
          >
            Código fuente en GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
