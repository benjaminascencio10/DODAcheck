"use client";

import { Suspense, useState } from "react";
import Scanner from "./Scanner";
import PedimentoCheck from "./PedimentoCheck";

type Mode = "doda" | "pedimento";

const COPY: Record<Mode, { title: string; desc: string }> = {
  doda: {
    title: "Verificar DODA",
    desc: "Escanea su código QR, sube el PDF, o sube una foto del documento impreso.",
  },
  pedimento: {
    title: "Verificar Pedimento",
    desc: "Sube el PDF o una foto del Pedimento para leer su estatus directo del SOIA del SAT.",
  },
};

export default function VerifierHome() {
  const [mode, setMode] = useState<Mode>("doda");
  const { title, desc } = COPY[mode];

  return (
    <div className="max-w-lg mx-auto px-4 py-4 sm:py-10">
      <div className="mb-4 sm:mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">DODAScanner</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-6">
        <button
          onClick={() => setMode("doda")}
          className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
            mode === "doda"
              ? "border-blue-600 bg-blue-50 text-blue-700"
              : "border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          Revisar DODA
        </button>
        <button
          onClick={() => setMode("pedimento")}
          className={`px-4 py-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
            mode === "pedimento"
              ? "border-blue-600 bg-blue-50 text-blue-700"
              : "border-slate-200 text-slate-600 hover:border-slate-300"
          }`}
        >
          Revisar Pedimento
        </button>
      </div>

      <p className="text-slate-500 text-sm text-center mb-6">{desc}</p>

      {mode === "doda" ? (
        <Suspense fallback={<div className="h-64 flex items-center justify-center text-slate-400 text-sm">Cargando escáner…</div>}>
          <Scanner />
        </Suspense>
      ) : (
        <PedimentoCheck satData={null} />
      )}
    </div>
  );
}
