"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { parseQrContent, buildSatUrl, DodaResult, getNumeroIntegracion } from "@/lib/doda-parser";
import { extraerCamposPdf, parseCamposTexto, type PdfCampos } from "@/lib/doda-pdf-campos";
import { extraerTextoFoto } from "@/lib/ocr";
import { getPdfjs } from "@/lib/pdfjs";
import ResultCard, { SatData } from "./ResultCard";

type ScanState = "idle" | "scanning" | "verifying" | "result" | "error";

const SCANNER_ELEMENT_ID = "qr-scanner-region";

export default function Scanner() {
  const [state, setState] = useState<ScanState>("idle");
  const [result, setResult] = useState<DodaResult | null>(null);
  const [satData, setSatData] = useState<SatData | null>(null);
  const [pdfCampos, setPdfCampos] = useState<PdfCampos | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [manualNi, setManualNi] = useState("");
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  // html5-qrcode lanza una excepción SÍNCRONA ("Cannot stop, scanner is not
  // running or paused") si se llama a stop() mientras start() todavía está
  // negociando la cámara (antes de terminar de transicionar a SCANNING) — y
  // en ese caso NUNCA cierra el stream que el navegador ya abrió. stopScanner()
  // espera esta promesa antes de intentar stop() para no caer en esa carrera.
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const niParam = searchParams.get("ni");

  const stopScanner = useCallback(async () => {
    // Si hay un start() en curso, hay que esperarlo primero — ver comentario
    // en startPromiseRef.
    if (startPromiseRef.current) {
      await startPromiseRef.current.catch(() => {});
      startPromiseRef.current = null;
    }
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // already stopped
      }
      scannerRef.current = null;
    }
    // Cinturón y tirantes: si pese a lo anterior el stream sigue vivo (la
    // librería tampoco lo suelta si camera.render() falla después de que
    // getUserMedia() ya concedió el permiso), se apaga el track a mano para
    // que el indicador de cámara del navegador se apague sí o sí.
    document
      .getElementById(SCANNER_ELEMENT_ID)
      ?.querySelectorAll("video")
      .forEach((video) => {
        const stream = video.srcObject;
        if (stream instanceof MediaStream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        video.srcObject = null;
      });
  }, []);

  const fetchSatData = useCallback(async (ni: string): Promise<SatData | null> => {
    try {
      const res = await fetch(`/api/doda?ni=${encodeURIComponent(ni)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const handleScanSuccess = useCallback(
    async (decodedText: string, pdfCamposArg: PdfCampos | null = null) => {
      await stopScanner();

      const parsed = parseQrContent(decodedText);
      setResult(parsed);

      const ni = getNumeroIntegracion(parsed);
      if (ni) {
        setState("verifying");
        const sat = await fetchSatData(ni);
        setSatData(sat);
      }

      setState("result");
    },
    [stopScanner, fetchSatData]
  );

  const startScanner = useCallback(async () => {
    setState("scanning");
    setErrorMsg("");
    setSatData(null);
    setPdfCampos(null);
    setResult(null);

    const attempt = async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;

      const config = {
        fps: 10,
        qrbox: { width: 260, height: 260 },
        aspectRatio: 1.0,
        disableFlip: false,
      };
      try {
        // Try rear camera first (exact match → no picker dialog on mobile)
        await scanner.start(
          { facingMode: { exact: "environment" } },
          config,
          (decodedText) => handleScanSuccess(decodedText),
          () => {}
        );
      } catch {
        // Fallback: any rear-facing or default camera
        await scanner.start(
          { facingMode: "environment" },
          config,
          (decodedText) => handleScanSuccess(decodedText),
          () => {}
        );
      }
    };

    // Se guarda la promesa ANTES de esperarla para que, si el usuario cancela
    // (o sube un archivo) mientras la cámara todavía está negociando permiso,
    // stopScanner() la espere en vez de llamar stop() de inmediato — ver
    // comentario en startPromiseRef.
    const p = attempt();
    startPromiseRef.current = p;
    try {
      await p;
    } catch (err) {
      await stopScanner();
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")) {
        setErrorMsg(
          "No se pudo acceder a la cámara. Por favor, otorgue permiso e intente de nuevo, o use la opción de subir imagen."
        );
      } else {
        setErrorMsg(
          "No se pudo iniciar el escáner. Intente subir una imagen del código QR."
        );
      }
      setState("error");
    } finally {
      startPromiseRef.current = null;
    }
  }, [handleScanSuccess, stopScanner]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      setErrorMsg("");
      setSatData(null);
      setPdfCampos(null);
      setState("verifying"); // show spinner while processing

      // Se captura en variable local (no solo en el estado) porque handleScanSuccess
      // es un callback ya creado en un render anterior: su clausura sobre el estado
      // `pdfCampos` quedaría desactualizada si dependiéramos de leerlo ahí adentro.
      let campos: PdfCampos | null = null;

      try {
        let scanableFile = file;
        const esPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

        if (esPdf) {
          // PDF → render page 1 to PNG for the QR scan + extract the printed fields
          const pdfjsLib = await getPdfjs();
          const arrayBuffer = await file.arrayBuffer();

          // Confrontación PDF impreso ↔ SAT (best-effort, nunca bloquea el escaneo)
          campos = await extraerCamposPdf(arrayBuffer.slice(0));
          setPdfCampos(campos);

          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2.5 }); // high-res for QR readability

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvas, viewport }).promise;

          const blob = await new Promise<Blob>((res) =>
            canvas.toBlob((b) => res(b!), "image/png")
          );
          scanableFile = new File([blob], "doda-page1.png", { type: "image/png" });
        } else {
          // Foto del documento impreso → OCR para el texto humano, igual
          // confrontación que un PDF (ver lib/ocr.ts). Best-effort: si el OCR
          // falla o no reconoce nada, simplemente no hay campos que comparar
          // — no bloquea el escaneo del QR.
          try {
            const texto = await extraerTextoFoto(file);
            campos = parseCamposTexto(texto);
            setPdfCampos(campos);
          } catch {
            /* OCR falló — sigue con el escaneo del QR */
          }
        }

        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("qr-file-scanner-hidden");
        const decoded = await scanner.scanFile(scanableFile, false);
        await scanner.clear();
        await handleScanSuccess(decoded, campos);
      } catch {
        setErrorMsg(
          "No se pudo leer el código QR. Verifique que el archivo sea legible y el código QR sea visible."
        );
        setState("error");
      }
    },
    [handleScanSuccess]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      e.target.value = "";
    },
    [handleFileUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const reset = useCallback(async () => {
    await stopScanner();
    setResult(null);
    setSatData(null);
    setPdfCampos(null);
    setErrorMsg("");
    setState("idle");
  }, [stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const lookupByNi = useCallback((rawNi: string) => {
    const ni = rawNi.replace(/\D/g, "");
    if (ni.length < 7) return;
    // Use SAT URL format so getNumeroIntegracion() returns the NI (plain NI → type:"unknown" → null)
    const syntheticResult = parseQrContent(buildSatUrl(ni));
    setResult(syntheticResult);
    setSatData(null);
    setPdfCampos(null);
    setErrorMsg("");
    setState("verifying");
    fetchSatData(ni).then(sat => {
      setSatData(sat);
      setState("result");
    });
  }, [fetchSatData]);

  const handleManualNiSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      lookupByNi(manualNi);
    },
    [lookupByNi, manualNi]
  );

  // Handle ?ni= query param (p.ej. desde un link de integración de un TMS)
  useEffect(() => {
    if (!niParam || state !== "idle") return;
    lookupByNi(niParam);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [niParam]);

  if (state === "result" && result) {
    return <ResultCard result={result} satData={satData} pdfCampos={pdfCampos} onScanAnother={reset} />;
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Scanner viewport */}
      <div
        className={`relative bg-slate-900 rounded-2xl overflow-hidden ${
          state === "scanning" ? "block" : "hidden"
        }`}
      >
        <div id={SCANNER_ELEMENT_ID} className="w-full aspect-square" />

        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="relative w-52 h-52">
            <Corner className="top-0 left-0" position="tl" />
            <Corner className="top-0 right-0" position="tr" />
            <Corner className="bottom-0 right-0" position="br" />
            <Corner className="bottom-0 left-0" position="bl" />
          </div>
        </div>

        <button
          onClick={reset}
          className="absolute top-3 right-3 bg-black/50 hover:bg-black/70 active:bg-black/70 text-white rounded-lg p-3 transition-colors"
          aria-label="Cancelar"
        >
          <XIcon className="w-5 h-5" />
        </button>
      </div>

      {state === "scanning" && (
        <p className="text-center text-slate-500 text-sm">
          Apunte al código QR del DODA
        </p>
      )}

      {/* Verifying state */}
      {state === "verifying" && (
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="font-medium text-slate-800 text-sm">Consultando el SAT…</p>
            <p className="text-slate-400 text-xs mt-1">Verificando estado del documento</p>
          </div>
        </div>
      )}

      {/* Idle state */}
      {state === "idle" && (
        <div className="space-y-4">
          <button
            onClick={startScanner}
            className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-6 py-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25"
          >
            <CameraIcon />
            Iniciar escaneo
          </button>

          <Divider />
          <UploadArea onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} />

          <Divider />
          <ManualNiForm value={manualNi} onChange={setManualNi} onSubmit={handleManualNiSubmit} />
        </div>
      )}

      {/* Error state */}
      {state === "error" && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-3">
            <AlertIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{errorMsg}</p>
          </div>

          <button
            onClick={startScanner}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2"
          >
            <CameraIcon />
            Intentar de nuevo
          </button>

          <Divider />
          <UploadArea onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} />

          <Divider />
          <ManualNiForm value={manualNi} onChange={setManualNi} onSubmit={handleManualNiSubmit} />
        </div>
      )}

      {/* Instructions */}
      {(state === "idle" || state === "error") && (
        <div className="bg-slate-50 rounded-xl px-4 py-4 space-y-2">
          <p className="text-xs font-medium text-slate-600">Instrucciones</p>
          <ul className="text-xs text-slate-500 space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">1.</span>
              Localice el código QR en su documento DODA impreso o digital.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">2.</span>
              Presione &quot;Iniciar escaneo&quot; y apunte la cámara al código QR.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">3.</span>
              O suba el PDF, o una foto del documento impreso — se confronta el
              texto reconocido contra el QR/cadena y el SAT.
            </li>
          </ul>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      <div id="qr-file-scanner-hidden" className="hidden" />
    </div>
  );
}

function Divider() {
  return (
    <div className="relative flex items-center gap-3">
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-xs text-slate-400 flex-shrink-0">o</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

function UploadArea({
  onDrop,
  onClick,
}: {
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${
        dragging
          ? "border-blue-400 bg-blue-50"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <UploadIcon className="mx-auto mb-3 text-slate-400" />
      <p className="text-sm font-medium text-slate-600 mb-1">Subir PDF o foto del documento</p>
      <p className="text-xs text-slate-400">Arrastre un archivo o haga clic para seleccionar</p>
      <p className="text-xs text-slate-400 mt-1">PDF · JPG · PNG · WebP</p>
    </div>
  );
}

function ManualNiForm({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const niDigits = value.replace(/\D/g, "");

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor="manual-ni" className="block text-xs font-medium text-slate-600">
        O escriba el Número de Integración (NI)
      </label>
      <div className="flex gap-2">
        <input
          id="manual-ni"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ej. 1234567890"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={niDigits.length < 7}
          className="shrink-0 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold px-5 py-3 rounded-xl text-sm transition-colors"
        >
          Consultar
        </button>
      </div>
    </form>
  );
}

function Corner({ className = "", position }: { className?: string; position: "tl" | "tr" | "br" | "bl" }) {
  const borders = {
    tl: { borderTop: 3, borderLeft: 3, borderBottom: 0, borderRight: 0, borderRadius: "4px 0 0 0" },
    tr: { borderTop: 3, borderLeft: 0, borderBottom: 0, borderRight: 3, borderRadius: "0 4px 0 0" },
    br: { borderTop: 0, borderLeft: 0, borderBottom: 3, borderRight: 3, borderRadius: "0 0 4px 0" },
    bl: { borderTop: 0, borderLeft: 3, borderBottom: 3, borderRight: 0, borderRadius: "0 0 0 4px" },
  }[position];

  return (
    <div
      className={`absolute w-8 h-8 ${className}`}
      style={{ borderColor: "white", borderStyle: "solid", ...borders }}
    />
  );
}

function CameraIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </svg>
  );
}

function XIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function UploadIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`w-8 h-8 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}
