import Header from "@/components/Header";
import VerifierHome from "@/components/VerifierHome";

export default function HomePage() {
  return (
    <>
      <Header />

      <main className="flex-1 bg-slate-50">
        <VerifierHome />
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
