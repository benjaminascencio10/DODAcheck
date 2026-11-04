"use client";

import { useState, useCallback } from "react";
import { decodeQrFromFile } from "@/lib/qrFromFile";
import { parsePedimentoQr } from "@/lib/pedimento-parser";
import { confrontarPedimento, type Discrepancia } from "@/lib/confrontar-doda";
import { DiscrepancyAlert, type SatData } from "./ResultCard";

type Step = "idle" | "loading" | "result" | "error";

interface Movimiento {
  situacion: string;
  detalle: string;
  fecha: string;
}

interface PedimentoData {
  ok: boolean;
  aduanaNombre: string | null;
  patente: string | null;
  documento: string | null;
  tipoOperacion: string | null;
  claveDocumento: string | null;
  numeroOperacion: string | null;
  secuencia: string | null;
  factura: string | null;
  banco: string | null;
  movimientos: Movimiento[];
}

export default function PedimentoCheck({ satData }: { satData: SatData | null }) {
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [data, setData] = useState<PedimentoData | null>(null);
  const [discrepancias, setDiscrepancias] = useState<Discrepancia[]>([]);

  const handleFile = useCallback(
    async (file: File) => {
      setStep("loading");
      setErrorMsg("");
      try {
        const decoded = await decodeQrFromFile(file);
        const parsed = parsePedimentoQr(decoded);
        if (parsed.type !== "pedimento-url") {
          setErrorMsg("Ese código QR no es de un Pedimento (no coincide con el validador del SAT). ¿Subiste el documento correcto?");
          setStep("error");
          return;
        }

        const res = await fetch(`/api/pedimento?url=${encodeURIComponent(parsed.url)}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setErrorMsg(json.error || "No se pudo consultar el pedimento en el SAT.");
          setStep("error");
          return;
        }

        setData(json);
        const url = new URL(parsed.url);
        setDiscrepancias(
          confrontarPedimento({
            pedimentoQr: {
              pad: url.searchParams.get("pad") || "",
              pa: url.searchParams.get("pa") || "",
              dn: url.searchParams.get("dn") || "",
            },
            satData,
          })
        );
        setStep("result");
      } catch {
        setErrorMsg("No se pudo leer el código QR del pedimento. Verifique que el archivo sea legible.");
        setStep("error");
      }
    },
    [satData]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const hayCritico = discrepancias.some((d) => d.severidad === "critico");

  return (
    <div className="border border-slate-200 rounded-2xl px-5 py-4 space-y-3">
      {step === "idle" && (
        <label className="block border-2 border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-xl px-4 py-5 text-center cursor-pointer transition-colors">
          <input type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={handleFileChange} />
          <p className="text-sm font-medium text-slate-600">Subir Pedimento (PDF o foto)</p>
          <p className="text-xs text-slate-400 mt-1">Se lee el QR del documento</p>
        </label>
      )}

      {step === "loading" && (
        <div className="flex items-center gap-3 py-4 justify-center">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Consultando el pedimento en el SAT…</p>
        </div>
      )}

      {step === "error" && (
        <div className="space-y-3">
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
          <label className="block border-2 border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-xl px-4 py-5 text-center cursor-pointer transition-colors">
            <input type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={handleFileChange} />
            <p className="text-sm font-medium text-slate-600">Intentar de nuevo</p>
          </label>
        </div>
      )}

      {step === "result" && data && (
        <div className="space-y-3">
          {discrepancias.length > 0 ? (
            <DiscrepancyAlert discrepancias={discrepancias} hayCritico={hayCritico} />
          ) : (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              El pedimento coincide con lo verificado del DODA.
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {data.aduanaNombre && <Field label="Aduana" value={data.aduanaNombre} />}
            {data.patente && <Field label="Patente" value={data.patente} />}
            {data.documento && <Field label="Documento" value={data.documento} />}
            {data.tipoOperacion && <Field label="Tipo de operación" value={data.tipoOperacion} />}
            {data.claveDocumento && <Field label="Clave documento" value={data.claveDocumento} />}
            {data.numeroOperacion && <Field label="N° operación" value={data.numeroOperacion} />}
            {data.banco && <Field label="Banco" value={data.banco} />}
          </div>

          {data.movimientos.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Movimientos del Pedimento
              </p>
              <div className="space-y-1.5">
                {data.movimientos.map((m, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                    <div>
                      <p className="font-semibold text-slate-700">{m.situacion}</p>
                      {m.detalle && <p className="text-slate-500">{m.detalle}</p>}
                    </div>
                    <p className="text-slate-400 whitespace-nowrap">{m.fecha}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => { setStep("idle"); setData(null); setDiscrepancias([]); }}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Verificar otro pedimento
          </button>
        </div>
      )}

      <div id="qr-file-scanner-hidden" className="hidden" />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="font-semibold text-slate-800">{value}</p>
    </div>
  );
}
