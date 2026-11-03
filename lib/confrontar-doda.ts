// Confronta los datos del documento (QR cadena original + texto impreso del PDF)
// contra los datos oficiales que devuelve el SAT para ese NI.
//
// Regla de oro: solo se reporta una discrepancia cuando AMBOS lados tienen un
// valor normalizado no vacío. El scraper del SAT es regex sobre HTML y a menudo
// deja campos en null — un campo ausente nunca es una discrepancia.

import type { DodaResult } from "@/lib/doda-parser";
import type { SatData } from "@/components/ResultCard";
import type { PdfCampos } from "@/lib/doda-pdf-campos";

/** Igual que getNumeroIntegracion() de doda-parser; inline para no crear un
 *  import runtime (mantiene este módulo puro y testeable sin bundler). */
function niFromQr(qr: DodaResult): string | null {
  if (qr.type === "sat-url") return qr.numeroIntegracion;
  if (qr.type === "cadena") return qr.fields.numeroIntegracion || null;
  return null;
}

export type Severidad = "critico" | "alerta";

export type CampoDiscrepancia =
  | "patente"
  | "pedimento"
  | "seccionAduanera"
  | "numeroIntegracion";

export interface Discrepancia {
  campo: CampoDiscrepancia;
  /** valor tal como aparece en el DODA (texto impreso, cadena o QR) */
  valorDocumento: string;
  /** valor contra el que se comparó */
  valorReferencia: string;
  /** de dónde salió `valorReferencia`: el SAT, el QR escaneado, la cadena impresa,
   *  o el QR de un Pedimento distinto confrontado contra este DODA */
  fuenteReferencia: "sat" | "qr" | "cadena" | "pedimento-qr";
  severidad: Severidad;
}

// ── Normalizadores ───────────────────────────────────────────────────────────

const soloDigitos = (s: string) => s.replace(/\D/g, "");

/** "03414" → "3414" */
function normPatente(s: string | null | undefined): string {
  const d = soloDigitos(s ?? "").replace(/^0+/, "");
  return d;
}

/** "330-3414-6013156/1" → "6013156" · "6013156" → "6013156"
 *  Exportado: también lo usa confrontarPedimento() más abajo. */
export function normPedimento(s: string | null | undefined): string {
  if (!s) return "";
  const sinRemesa = s.split("/")[0];
  const grupos = sinRemesa.match(/\d{6,7}/g);
  if (!grupos || grupos.length === 0) return "";
  // El progresivo es el último grupo de 6-7 dígitos (AAA-PPPP-NNNNNNN)
  return grupos[grupos.length - 1];
}

/** código de aduana: exactamente 3 dígitos al inicio, seguidos de separador/nombre.
 *  Rechaza valores que sean parte de un número más largo (ej. el NI).
 *  Exportado: también lo usa confrontarPedimento() más abajo. */
export function normSeccion(s: string | null | undefined): string {
  const m = (s ?? "").trim().match(/^(\d{3})(?:\D|$)/);
  return m ? m[1] : "";
}

/** ¿el valor de pedimento del documento cubre varios pedimentos? */
function esPedimentoMultiple(cadenaTotal: string | null | undefined, docPedimento: string): boolean {
  const total = parseInt(soloDigitos(cadenaTotal ?? ""), 10);
  if (Number.isFinite(total) && total > 1) return true;
  const grupos = docPedimento.replace(/\/\d+/g, "").match(/\d{6,7}/g);
  return !!grupos && grupos.length > 1;
}

// ── Confrontación ────────────────────────────────────────────────────────────

interface Params {
  qr: DodaResult;
  satData: SatData | null;
  pdfCampos?: PdfCampos | null;
}

export function confrontarDoda({ qr, satData, pdfCampos }: Params): Discrepancia[] {
  const out: Discrepancia[] = [];
  const cadena = qr.type === "cadena" ? qr.fields : null;
  const niQr = niFromQr(qr);

  // ── Chequeos internos del documento (no dependen del SAT) ──
  // NI impreso vs NI del QR
  if (pdfCampos?.numeroIntegracion && niQr) {
    if (soloDigitos(pdfCampos.numeroIntegracion) !== soloDigitos(niQr)) {
      out.push({
        campo: "numeroIntegracion",
        valorDocumento: pdfCampos.numeroIntegracion,
        valorReferencia: niQr,
        fuenteReferencia: "qr",
        severidad: "critico",
      });
    }
  }
  // NI impreso vs NI de la cadena original del mismo PDF
  if (
    pdfCampos?.numeroIntegracion &&
    pdfCampos.cadena?.numeroIntegracion &&
    soloDigitos(pdfCampos.numeroIntegracion) !== soloDigitos(pdfCampos.cadena.numeroIntegracion)
  ) {
    out.push({
      campo: "numeroIntegracion",
      valorDocumento: pdfCampos.numeroIntegracion,
      valorReferencia: pdfCampos.cadena.numeroIntegracion,
      fuenteReferencia: "cadena",
      severidad: "critico",
    });
  }

  // ── Sin datos del SAT no hay nada más que confrontar ──
  if (!satData || !satData.ok) return dedupe(out);

  // NI no registrado en el SAT = señal fuerte de apócrifo
  if (satData.estado === "NO ENCONTRADO") {
    out.push({
      campo: "numeroIntegracion",
      valorDocumento: niQr || pdfCampos?.numeroIntegracion || "",
      valorReferencia: "no registrado",
      fuenteReferencia: "sat",
      severidad: "critico",
    });
    return dedupe(out);
  }

  // ── Tres fuentes de datos del documento, mantenidas SEPARADAS ──
  //  · qr     = lo que codifica el código QR escaneado
  //  · cadena = la cadena original ||...|| impresa en el papel
  //  · texto  = los campos legibles impresos en el cuerpo del DODA
  // Un DODA falso típico: el `texto` fue alterado pero `qr`/`cadena` están intactos.
  const qrCad = cadena;
  const prCad = pdfCampos?.cadena ?? null;
  const txt = pdfCampos ?? null;

  /** aduana (3 díg) a partir de un pedimento en formato AAA-PPPP-NNNNNNN */
  const aduDe = (ped: string | null | undefined) =>
    (ped || "").match(/(?:^|\D)(\d{3})-\d{4}-/)?.[1] ?? "";

  revisarCampo("patente", normPatente, satData.patente, {
    qr: qrCad?.patente,
    cadena: prCad?.patente,
    texto: txt?.patente,
  });

  revisarCampo("seccionAduanera", normSeccion, satData.aduana, {
    qr: aduDe(qrCad?.pedimentos) || qrCad?.seccion,
    cadena: aduDe(prCad?.pedimentos) || prCad?.seccion,
    texto: aduDe(txt?.pedimentos) || txt?.seccion,
  });

  const multiple = esPedimentoMultiple(
    qrCad?.totalPedimentos ?? prCad?.totalPedimentos,
    txt?.pedimentos || qrCad?.pedimentos || ""
  );
  if (!multiple) {
    revisarCampo("pedimento", normPedimento, satData.pedimento, {
      qr: qrCad?.pedimentos,
      cadena: prCad?.pedimentos,
      texto: txt?.pedimentos,
    });
  }

  return dedupe(out);

  // ── helper local ──
  function revisarCampo(
    campo: CampoDiscrepancia,
    norm: (s: string | null | undefined) => string,
    sat: string | null | undefined,
    fuentes: { qr?: string | null; cadena?: string | null; texto?: string | null }
  ) {
    const ents = (["qr", "cadena", "texto"] as const)
      .map((f) => ({ f, v: fuentes[f] ?? "" }))
      .filter((e) => norm(e.v));

    const nsat = norm(sat);

    // 1) cada valor del documento contra el SAT (fuente de verdad)
    for (const e of ents) {
      if (nsat && norm(e.v) !== nsat) {
        out.push({
          campo,
          valorDocumento: e.v.trim(),
          valorReferencia: String(sat).trim(),
          fuenteReferencia: "sat",
          severidad: "critico",
        });
      }
    }

    // 2) el TEXTO impreso contra el QR / la cadena (papel alterado, QR intacto)
    const texto = ents.find((e) => e.f === "texto");
    if (texto) {
      for (const e of ents) {
        if (e.f !== "texto" && norm(e.v) !== norm(texto.v)) {
          out.push({
            campo,
            valorDocumento: texto.v.trim(),
            valorReferencia: e.v.trim(),
            fuenteReferencia: e.f, // "qr" | "cadena"
            severidad: "critico",
          });
        }
      }
    }
  }
}

// ── Confronta cruzada: QR del Pedimento vs el SAT del DODA ──────────────────
// Documento distinto al DODA, con su propio QR (ver lib/pedimento-parser.ts
// y app/api/pedimento/route.ts). El pedimento se reconstruye desde la query
// string YA VALIDADA de esa URL (pad-pa-dn), no desde el HTML — el HTML solo
// trae el nombre de la aduana, no su clave de 3 dígitos.

export interface PedimentoQrData {
  pad: string; // clave de aduana (3 díg)
  pa: string;  // patente
  dn: string;  // documento / progresivo del pedimento
}

export function confrontarPedimento({
  pedimentoQr,
  satData,
}: {
  pedimentoQr: PedimentoQrData;
  satData: SatData | null;
}): Discrepancia[] {
  const out: Discrepancia[] = [];
  if (!satData || !satData.ok) return out;

  const pedimentoReconstruido = `${pedimentoQr.pad}-${pedimentoQr.pa}-${pedimentoQr.dn}`;

  // Regla de oro de este módulo: solo se reporta si AMBOS lados tienen valor.
  const nSat = normPedimento(satData.pedimento);
  const nQr = normPedimento(pedimentoReconstruido);
  if (nSat && nQr && nSat !== nQr) {
    out.push({
      campo: "pedimento",
      valorDocumento: pedimentoReconstruido,
      valorReferencia: String(satData.pedimento).trim(),
      fuenteReferencia: "pedimento-qr",
      severidad: "critico",
    });
  }

  const nSatAduana = normSeccion(satData.aduana);
  const nQrAduana = normSeccion(pedimentoQr.pad);
  if (nSatAduana && nQrAduana && nSatAduana !== nQrAduana) {
    out.push({
      campo: "seccionAduanera",
      valorDocumento: pedimentoQr.pad,
      valorReferencia: String(satData.aduana).trim(),
      fuenteReferencia: "pedimento-qr",
      severidad: "critico",
    });
  }

  return out;
}

function dedupe(list: Discrepancia[]): Discrepancia[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const k = `${d.campo}|${d.valorDocumento}|${d.valorReferencia}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function tieneCritico(list: Discrepancia[]): boolean {
  return list.some((d) => d.severidad === "critico");
}
