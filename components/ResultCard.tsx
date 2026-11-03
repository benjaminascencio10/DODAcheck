"use client";

import { useMemo, useState } from "react";
import { DodaResult, buildSatUrl, getNumeroIntegracion } from "@/lib/doda-parser";
import { confrontarDoda, tieneCritico, type Discrepancia } from "@/lib/confrontar-doda";
import type { PdfCampos } from "@/lib/doda-pdf-campos";
import PedimentoCheck from "./PedimentoCheck";

export interface SatData {
  ok: boolean;
  estado: string | null;
  aduana: string | null;
  patente: string | null;
  pedimento: string | null;
  trailer: string | null;
  fechaImpresion: string | null;
  fechaEmision: string | null;
  fechaCruce: string | null;
  tipoOperacion: string | null;
  clavePedimento: string | null;
  folioCFDI: string | null;
  seccionAduanera: string | null;
  error?: string;
}

interface ResultCardProps {
  result: DodaResult;
  satData: SatData | null;
  pdfCampos?: PdfCampos | null;
  onScanAnother: () => void;
}

const ESTADO_CONFIG: Record<string, {
  label: string;
  badge: string;
  text: string;
  dot: string;
}> = {
  DESADUANAMIENTOLIBRE:                { label: "Desaduanamiento Libre",             badge: "bg-emerald-400/15", text: "text-emerald-400", dot: "bg-emerald-400" },
  "RECONOCIMIENTO ADUANERO CONCLUIDO": { label: "Reconocimiento Aduanero Concluido", badge: "bg-emerald-400/15", text: "text-emerald-400", dot: "bg-emerald-400" },
  "EN RECONOCIMIENTO ADUANERO":        { label: "En Reconocimiento Aduanero",        badge: "bg-amber-400/15",   text: "text-amber-400",   dot: "bg-amber-400"   },
  "RECONOCIMIENTO ADUANERO":           { label: "Reconocimiento Aduanero",           badge: "bg-amber-400/15",   text: "text-amber-400",   dot: "bg-amber-400"   },
  "SEGUNDO RECONOCIMIENTO":            { label: "Segundo Reconocimiento",            badge: "bg-amber-400/15",   text: "text-amber-400",   dot: "bg-amber-400"   },
  MODULACION:                          { label: "Modulación",                        badge: "bg-amber-400/15",   text: "text-amber-400",   dot: "bg-amber-400"   },
  "DODA NO PRESENTADO":                { label: "DODA No Presentado",                badge: "bg-red-400/15",     text: "text-red-400",     dot: "bg-red-400"     },
  ELIMINADO:                           { label: "Eliminado",                         badge: "bg-red-400/15",     text: "text-red-400",     dot: "bg-red-400"     },
  "NO ENCONTRADO":                     { label: "No Encontrado",                     badge: "bg-red-400/15",     text: "text-red-400",     dot: "bg-red-400"     },
  PREVIO:                              { label: "Previo",                            badge: "bg-blue-400/15",    text: "text-blue-400",    dot: "bg-blue-400"    },
  PENDIENTE:                           { label: "Pendiente",                         badge: "bg-blue-400/15",    text: "text-blue-400",    dot: "bg-blue-400"    },
};

const DANGER_STATES = new Set(["ELIMINADO", "NO ENCONTRADO"]);
const ALREADY_CROSSED_STATES = new Set(["DESADUANAMIENTOLIBRE", "RECONOCIMIENTO ADUANERO CONCLUIDO"]);

const FIELD_LABELS: Record<Discrepancia["campo"], string> = {
  patente: "Patente / Autorización",
  pedimento: "Pedimento",
  seccionAduanera: "Sección aduanera",
  numeroIntegracion: "Número de Integración",
};

const SOURCE_LABELS: Record<Discrepancia["fuenteReferencia"], string> = {
  sat: "SAT",
  qr: "QR",
  cadena: "Cadena original",
  "pedimento-qr": "QR del Pedimento",
};

// ── Pedimento type detection ──────────────────────────────────────────────────

function detectPedimentoType(
  clavePedimento: string | null,
  pedimento: string | null
): 'consolidado' | 'normal' {
  if (clavePedimento && /^c/i.test(clavePedimento)) return 'consolidado';
  if (pedimento && /\/[1-9](?!\d)/.test(pedimento)) return 'consolidado';
  return 'normal';
}

// ── Expiry helpers ────────────────────────────────────────────────────────────

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function getSundayOfWeek(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow));
  return d;
}

function daysFromNow(target: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

function parseDateStr(s: string): { date: string; time: string | null } {
  const datePart = s.split(/[T\s]/)[0];
  const [y, mo, day] = datePart.split('-').map(Number);
  const dt = new Date(y, mo - 1, day);
  const dateStr = fmtDate(dt);
  const timeMatch = s.match(/[T\s](\d{2}:\d{2})/);
  return { date: dateStr, time: timeMatch ? timeMatch[1] : null };
}

function dateToBase(s: string): Date {
  const datePart = s.split(/[T\s]/)[0];
  const [y, mo, day] = datePart.split('-').map(Number);
  return new Date(y, mo - 1, day, 12, 0, 0);
}

function expiryStyle(days: number): { color: string; bg: string; border: string } {
  if (days < 0)   return { color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200"     };
  if (days === 0) return { color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200"     };
  if (days <= 2)  return { color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200"   };
  return               { color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" };
}

function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return "Vencido";
  if (daysLeft === 0) return "Vence hoy";
  if (daysLeft === 1) return "1 día restante";
  return `${daysLeft} días restantes`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResultCard({ result, satData, pdfCampos, onScanAnother }: ResultCardProps) {
  const [copied, setCopied] = useState(false);

  const ni = getNumeroIntegracion(result);

  const discrepancias = useMemo(
    () => confrontarDoda({ qr: result, satData, pdfCampos: pdfCampos ?? null }),
    [result, satData, pdfCampos]
  );
  const hayCritico = tieneCritico(discrepancias);
  const satUrl          = ni ? buildSatUrl(ni) : null;
  const cfg             = satData?.estado ? ESTADO_CONFIG[satData.estado] : null;
  const isDanger        = satData?.estado ? DANGER_STATES.has(satData.estado) : false;
  const alreadyCrossed  = satData?.estado ? ALREADY_CROSSED_STATES.has(satData.estado) : false;

  const pedimento       = satData?.pedimento      || (result.type === "cadena" ? result.fields.pedimentos : null);
  const seccionAduanera = satData?.seccionAduanera || (result.type === "cadena" ? result.fields.seccion   : null);
  const patente         = satData?.patente        || (result.type === "cadena" ? result.fields.patente    : null);
  // QR cadena: placa=parts[5] es la placa del vehículo; contenedor=parts[6] es el N° Económico
  const trailer         = (result.type === "cadena" ? result.fields.contenedor : null) || satData?.trailer || null;
  const fechaCruce     = satData?.fechaEmision || null;
  const fechaQR        = result.type === "cadena" ? result.fields.fecha : null;
  const fechaImpresion = fechaQR
    || satData?.fechaImpresion
    || (!alreadyCrossed ? satData?.fechaEmision : null)
    || null;
  const folioCFDI       = satData?.folioCFDI      || null;

  const pedimentoType = detectPedimentoType(satData?.clavePedimento ?? null, pedimento);

  let expiryDate: Date | null = null;
  if (fechaImpresion && !isDanger) {
    const base = dateToBase(fechaImpresion);
    expiryDate = pedimentoType === 'consolidado'
      ? getSundayOfWeek(base)
      : addBusinessDays(base, 3);
  }
  const daysLeft = expiryDate ? daysFromNow(expiryDate) : null;

  const handleCopy = async () => {
    const statusLabel = cfg?.label ?? '';
    const typeLabel = pedimentoType === 'consolidado' ? 'Consolidado' : 'Normal';

    const expLine = alreadyCrossed
      ? (fechaCruce ? [`Fec. de Cruce:   ${fechaCruce}`] : [])
      : expiryDate
        ? [`Vence (${typeLabel}):   ${fmtDate(expiryDate)} (${daysLeft} días)`]
        : [];

    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━",
      "DODA — Estado del Documento",
      "━━━━━━━━━━━━━━━━━━━━━",
      ...(ni              ? [`NI:              ${ni}`]              : []),
      ...(pedimento       ? [`Pedimento:    ${pedimento}`]          : []),
      ...(trailer         ? [`Trailer:      ${trailer}`]            : []),
      ...(cfg             ? [`Estado SAT:    ${statusLabel}`]       : []),
      ...(seccionAduanera ? [`Sección:     ${seccionAduanera}`]     : []),
      ...(fechaImpresion  ? [`Fec. Creación:  ${fechaImpresion}`]   : []),
      ...expLine,
      ...(folioCFDI       ? [`CFDI:         ${folioCFDI}`]          : []),
      "━━━━━━━━━━━━━━━━━━━━━",
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-3">

      {/* ── Hero: Estado SAT + NI + Pedimento ── */}
      <div className={`bg-slate-900 rounded-2xl px-6 py-6 ${hayCritico ? "ring-2 ring-red-500" : ""}`}>
        {hayCritico && (
          <div className="-mx-6 -mt-6 mb-5 px-6 py-2.5 bg-red-600 rounded-t-2xl flex items-center gap-2">
            <AlertTriangleIcon className="w-4 h-4 text-white flex-shrink-0" />
            <p className="text-xs font-bold text-white uppercase tracking-wide">El documento no coincide con el SAT</p>
          </div>
        )}
        <div className="mb-5">
          {cfg ? (
            <span className={`inline-flex items-center gap-2 ${cfg.badge} ${cfg.text} text-xs font-semibold px-3 py-1.5 rounded-full`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`} />
              Estado SAT — {cfg.label}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 bg-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Documento leído
            </span>
          )}
        </div>

        {ni && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Número de Integración</p>
            <p className="text-3xl font-bold font-mono text-blue-400 tracking-tight">{ni}</p>
          </div>
        )}

        {pedimento && (
          <div className="border-t border-slate-800 pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Pedimento</p>
            <p className="text-base font-semibold text-slate-200 font-mono">{pedimento}</p>
          </div>
        )}
      </div>

      {/* ── Discrepancia documento ↔ SAT ── */}
      {discrepancias.length > 0 && (
        <DiscrepancyAlert discrepancias={discrepancias} hayCritico={hayCritico} />
      )}

      {/* ── Vigencia del Documento ── */}
      {(fechaImpresion || (alreadyCrossed && fechaCruce)) && (
        <div className="bg-white border border-slate-100 rounded-2xl px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Vigencia del Documento</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              pedimentoType === 'consolidado' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {pedimentoType === 'consolidado' ? 'Consolidado' : 'Normal'}
            </span>
          </div>

          <div className={`grid gap-2 ${(!fechaImpresion && alreadyCrossed && fechaCruce) ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {fechaImpresion && (
              <DateStampCell label="Fecha de Impresión" dateStr={fechaImpresion} variant="neutral" />
            )}
            {alreadyCrossed && fechaCruce ? (
              <DateStampCell label="Fecha de Cruce" dateStr={fechaCruce} variant="success" stamped />
            ) : expiryDate && daysLeft !== null ? (
              <ExpiryCell date={expiryDate} daysLeft={daysLeft} pedimentoType={pedimentoType} />
            ) : fechaImpresion ? (
              <PendingCruceCell />
            ) : null}
          </div>

          <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
            * Días hábiles sin incluir festivos oficiales. Confirme con su agente aduanal.
          </p>
        </div>
      )}

      {/* ── Información Aduanera — caja azul ── */}
      {(seccionAduanera || patente || trailer) && (
        <div className="bg-blue-600 rounded-2xl px-5 py-4">
          <p className="text-[11px] font-semibold text-blue-200 uppercase tracking-wider mb-3">Información Aduanera</p>
          {seccionAduanera && (
            <div className="mb-3">
              <p className="text-[10px] text-blue-300 uppercase tracking-wider mb-0.5">Sección Aduanera</p>
              <p className="text-sm font-semibold text-white leading-snug">{seccionAduanera}</p>
            </div>
          )}
          {(patente || trailer) && (
            <div className="grid grid-cols-2 gap-3">
              {patente && (
                <div>
                  <p className="text-[10px] text-blue-300 uppercase tracking-wider mb-0.5">Patente</p>
                  <p className="text-sm font-bold text-white font-mono break-all">{patente}</p>
                </div>
              )}
              {trailer && (
                <div>
                  <p className="text-[10px] text-blue-300 uppercase tracking-wider mb-0.5">Trailer / Económico</p>
                  <p className="text-sm font-bold text-white font-mono break-all">{trailer}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Folio CFDI — Carta Porte ── */}
      {folioCFDI && (
        <div className="border border-amber-200 bg-amber-50 rounded-2xl px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <DocumentIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Folio CFDI — Carta Porte</p>
          </div>
          <p className="text-xs font-mono text-amber-900 font-bold break-all leading-relaxed tracking-wide">{folioCFDI}</p>
        </div>
      )}

      {/* ── Danger alert ── */}
      {isDanger && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 space-y-3">
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangleIcon className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-800 mb-1">Documento expirado — No apto para cruce</p>
              <p className="text-sm text-red-700 leading-snug">
                No utilice este documento para cruzar la frontera. El uso de un DODA eliminado puede resultar en multa o retención de la unidad.
              </p>
            </div>
          </div>
          <div className="flex gap-2.5 items-start pl-11">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
            <p className="text-sm text-red-700 leading-snug">
              Contacte a su agente aduanal para actualizar o generar un nuevo documento de cruce.
            </p>
          </div>
        </div>
      )}

      {/* ── SAT no disponible ── */}
      {satData && !satData.ok && !satData.estado && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex gap-2.5 items-start">
          <InfoCircleIcon className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 leading-relaxed">
            No se pudo obtener el estado del SAT. Los datos del QR se muestran sin verificar en línea.
          </p>
        </div>
      )}

      {/* ── Copiar datos para compartir ── */}
      <button
        onClick={handleCopy}
        className={`w-full flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl border transition-all duration-200 text-sm font-semibold cursor-pointer ${
          copied
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
        }`}
      >
        {copied ? (
          <><CheckCircleIcon className="w-4 h-4" /> ¡Copiado al portapapeles!</>
        ) : (
          <><ClipboardIcon className="w-4 h-4" /> Copiar datos para compartir</>
        )}
      </button>

      {/* ── Verificar Pedimento (documento distinto, confronta cruzada) ── */}
      {pedimento && <PedimentoCheck satData={satData} />}

      {/* ── QR raw (colapsado) ── */}
      <details>
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600 transition-colors select-none px-1">
          Ver contenido raw del QR
        </summary>
        <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <pre className="text-xs text-slate-600 break-all whitespace-pre-wrap font-mono">{result.raw}</pre>
        </div>
      </details>

      {/* ── Acciones ── */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onScanAnother}
          className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-5 py-3.5 rounded-xl transition-colors text-sm cursor-pointer shadow-lg shadow-blue-600/20"
        >
          Escanear otro DODA
        </button>
        {satUrl && (
          <a
            href={satUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold px-4 py-3.5 rounded-xl transition-colors text-sm flex items-center gap-1.5 cursor-pointer"
          >
            SAT
            <ExternalLinkIcon className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      <p className="text-[11px] text-slate-400 text-center px-4 leading-relaxed">
        Información extraída del DODA. La validación oficial depende del SAT.
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DateStampCell({ label, dateStr, variant, stamped }: {
  label: string;
  dateStr: string;
  variant: 'neutral' | 'success';
  stamped?: boolean;
}) {
  const { date, time } = parseDateStr(dateStr);
  const baseStyle = variant === 'success'
    ? "rounded-xl border border-emerald-200 px-3 py-3 bg-emerald-50"
    : "rounded-xl border border-slate-200 px-3 py-3 bg-slate-50";
  const labelStyle = variant === 'success' ? "text-emerald-700" : "text-slate-500";
  const dateStyle  = variant === 'success' ? "text-emerald-800" : "text-slate-800";
  const timeStyle  = variant === 'success' ? "text-emerald-600" : "text-slate-500";

  return (
    <div className={baseStyle}>
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1 ${labelStyle}`}>
        {stamped && <CheckCircleIcon className="w-3 h-3" />}
        {label}
      </p>
      <p className={`text-sm font-bold ${dateStyle}`}>{date}</p>
      {time && <p className={`text-xs mt-0.5 ${timeStyle}`}>{time}</p>}
    </div>
  );
}

function PendingCruceCell() {
  return (
    <div className="rounded-xl border border-blue-200 px-3 py-3 bg-blue-50">
      <p className="text-[10px] font-bold uppercase tracking-wider mb-2 text-blue-600">
        Fecha de Cruce
      </p>
      <p className="text-sm font-bold text-blue-700">Pendiente</p>
      <p className="text-xs text-blue-500 mt-0.5">En proceso</p>
    </div>
  );
}

function ExpiryCell({ date, daysLeft, pedimentoType }: {
  date: Date;
  daysLeft: number;
  pedimentoType: 'normal' | 'consolidado';
}) {
  const { color, bg, border } = expiryStyle(daysLeft);
  const rule = pedimentoType === 'consolidado' ? 'Dom. de la semana' : '3 días hábiles';

  return (
    <div className={`rounded-xl border ${border} ${bg} px-3 py-3`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${color}`}>
        Fecha de Expiración · {rule}
      </p>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold text-slate-800">{fmtDate(date)}</p>
        <p className={`text-xs font-semibold ${color}`}>{expiryLabel(daysLeft)}</p>
      </div>
    </div>
  );
}

export function DiscrepancyAlert({ discrepancias, hayCritico }: {
  discrepancias: Discrepancia[];
  hayCritico: boolean;
}) {
  const box = hayCritico
    ? "bg-red-50 border-red-200"
    : "bg-amber-50 border-amber-200";
  const heading = hayCritico ? "text-red-800" : "text-amber-800";
  const iconWrap = hayCritico ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600";

  return (
    <div className={`border rounded-2xl px-5 py-4 space-y-3 ${box}`}>
      <div className="flex gap-3 items-start">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${iconWrap}`}>
          <AlertTriangleIcon className="w-5 h-5" />
        </div>
        <div>
          <p className={`text-sm font-bold mb-1 ${heading}`}>Posible DODA falso o documento equivocado</p>
          <p className={`text-sm leading-snug ${hayCritico ? "text-red-700" : "text-amber-700"}`}>
            {hayCritico
              ? "Uno o más datos del documento no coinciden con lo que el SAT tiene registrado para este Número de Integración. Verifica con tu agente aduanal antes de usarlo en el cruce."
              : "Hay diferencias menores entre el documento y el SAT. Revísalas por si acaso."}
          </p>
        </div>
      </div>

      <div className="space-y-2 pl-11">
        {discrepancias.map((d, i) => (
          <div key={i} className="text-sm">
            <p className="font-semibold text-slate-800">
              {FIELD_LABELS[d.campo]}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs mt-0.5">
              <span className="text-slate-700">
                Documento: <b>{d.valorDocumento || "—"}</b>
              </span>
              <span className={hayCritico ? "text-red-700" : "text-amber-700"}>
                {SOURCE_LABELS[d.fuenteReferencia]}: <b>{d.valorReferencia}</b>
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed pl-11">
        Comparación automática contra la consulta pública del SAT. No sustituye la validación de tu agente aduanal.
      </p>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckCircleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function InfoCircleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}

function AlertTriangleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function ClipboardIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function DocumentIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function ExternalLinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
