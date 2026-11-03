// Extrae los datos del PDF de un DODA en DOS grupos independientes:
//   - `cadena`   → la cadena original ||...|| impresa (los datos "de máquina")
//   - los campos del TEXTO HUMANO impreso (NI, patente, pedimento, sección)
//
// Se mantienen separados a propósito: un DODA falso típico tiene el texto
// visible alterado pero la cadena/QR intactos. Comparar ambos revela el fraude.
//
// Los regex del texto humano son un port de parseDodaPdf() del server DC.

import type { CadenaFields } from "@/lib/doda-parser";
// Import diferido (no estático) para que node --test pueda cargar y probar
// parseCamposTexto() sin resolver "@/lib/pdfjs" — solo se usa dentro de
// extraerItems(), que los tests unitarios de parseCamposTexto no llaman.

/** Igual que el branch "cadena" de parseQrContent() en doda-parser.ts; inline
 *  para no crear un import runtime (mantiene este módulo puro y testeable sin
 *  bundler — mismo criterio que niFromQr() en confrontar-doda.ts). */
const CADENA_PATTERN = /^\|\|(.+?)(?:\|\|)?$/;
function parseCadenaFields(raw: string): CadenaFields | null {
  const m = raw.trim().match(CADENA_PATTERN);
  if (!m) return null;
  const parts = m[1].split("|");
  if (parts.length < 8) return null;
  return {
    seccion: parts[0] ?? "",
    patente: parts[1] ?? "",
    totalPedimentos: parts[2] ?? "",
    pedimentos: parts[3] ?? "",
    numeroIntegracion: parts[4] ?? "",
    placa: parts[5] ?? "",
    contenedor: parts[6] ?? "",
    fecha: parts[7] ?? "",
  };
}

export interface PdfCampos {
  /** cadena original ||...|| tal cual está impresa */
  cadenaOriginal: string | null;
  /** cadena impresa ya parseada en campos */
  cadena: CadenaFields | null;
  /** ── campos leídos del TEXTO HUMANO impreso (independientes de la cadena) ── */
  numeroIntegracion: string | null;
  patente: string | null;
  pedimentos: string | null;
  seccion: string | null;
}

const EMPTY: PdfCampos = {
  cadenaOriginal: null,
  cadena: null,
  numeroIntegracion: null,
  patente: null,
  pedimentos: null,
  seccion: null,
};

/** Un span de texto de pdf.js con su posición y si termina línea. */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  hasEOL: boolean;
}

/** Extrae los items de texto de todas las páginas, con posición (x,y). */
async function extraerItems(data: ArrayBuffer): Promise<PdfItem[]> {
  const { getPdfjs } = await import("@/lib/pdfjs");
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const items: PdfItem[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item && item.str !== undefined) {
        items.push({
          str: item.str,
          x: item.transform?.[4] ?? 0,
          y: item.transform?.[5] ?? 0,
          hasEOL: !!item.hasEOL,
        });
      }
    }
  }
  return items;
}

/** Reconstruye el texto respetando el fin de línea REAL que reporta pdf.js
 *  (`hasEOL`) en vez de insertar un "\n" entre cada item. El generador del
 *  SAT parte números y hasta la cadena original en varios items dentro de
 *  UNA misma línea visual (ej. el NI "145748112" llega como los items
 *  "145748" + "112"): unirlos sin separador hasta el próximo `hasEOL`
 *  reconstruye la línea tal como se ve impresa. Unir todo con "\n" a ciegas
 *  —el comportamiento anterior— parte esos valores y rompe su regex. */
function reconstruirTexto(items: PdfItem[]): string {
  let out = "";
  for (const it of items) {
    out += it.str;
    if (it.hasEOL) out += "\n";
  }
  return out;
}

/** Busca un valor que matchee `valorRe` en la misma FILA (proximidad en Y)
 *  que la etiqueta que matchea `etiquetaRe`. El PDF del DODA dibuja las
 *  etiquetas de la tabla como un bloque de texto y los valores llenados
 *  como otro bloque aparte del content stream — no quedan adyacentes al
 *  leerlos en orden (por eso una regex de texto con "etiqueta...valor" no
 *  los encuentra), pero sí comparten la misma altura de línea porque están
 *  en la misma fila de la tabla. Se usa solo como refuerzo del regex de
 *  texto (que sigue intentándose primero) para no depender únicamente de
 *  la posición. */
function valorPorFila(
  items: PdfItem[],
  etiquetaRe: RegExp,
  valorRe: RegExp,
  tolY = 3
): string | null {
  const label = items.find((it) => etiquetaRe.test(it.str));
  if (!label) return null;
  const fila = items
    .filter((it) => it !== label && Math.abs(it.y - label.y) <= tolY)
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str)
    .join("");
  const m = fila.match(valorRe);
  return m ? m[1] : null;
}

/** Parsea los campos a partir del texto ya extraído (y, opcionalmente, los
 *  items posicionados para el refuerzo por fila). Exportado para tests. */
export function parseCamposTexto(text: string, items: PdfItem[] = []): PdfCampos {
  const campos: PdfCampos = { ...EMPTY };

  // ── Cadena original ||seccion|patente|totalPed|pedimentos|NI|placa|contenedor|fecha| ──
  // Cierra con UN solo "|" en los DODA reales (igual que CADENA_PATTERN en
  // doda-parser.ts) — exigir "||" de cierre nunca matchea un documento real.
  let cadenaMatch = text.match(/CADENA\s*ORIGINAL:\s*\n?(\|\|[^\n]*\|)/i);
  if (!cadenaMatch) cadenaMatch = text.match(/^(\|\|[^\n]*\|)$/m);
  campos.cadenaOriginal = cadenaMatch ? cadenaMatch[1].trim() : null;
  if (campos.cadenaOriginal) {
    campos.cadena = parseCadenaFields(campos.cadenaOriginal.replace(/\s+/g, " "));
  }

  // ── Texto humano impreso — SIEMPRE por regex propio, nunca desde la cadena ──
  const niM =
    text.match(/N(?:[°º.]|o\.?)?\s*(?:DE\s+)?INTEGRACI[OÓ]N\s*:?\s*\n?\s*(\d{7,12})/i) ||
    text.match(/INTEGRACI[OÓ]N[^0-9]{0,20}(\d{7,12})/i);
  campos.numeroIntegracion = niM
    ? niM[1].trim()
    : valorPorFila(items, /N(?:[°º.]|o\.?)?\s*(?:DE\s+)?INTEGRACI[OÓ]N/i, /(\d{7,12})/);

  const patM = text.match(/PATENTE\s*(?:O\s*AUTORIZACI[OÓ]N)?[^0-9]{0,20}(\d{3,5})(?!\d)/i);
  if (patM) campos.patente = patM[1].trim();

  // Pedimento impreso: "AAA-PPPP-NNNNNNN" (con guiones, sin ambigüedad)
  const pedM = text.match(/(\d{3}-\d{4}-\d{6,7}(?:\/\d+)?)/);
  if (pedM) campos.pedimentos = pedM[1].trim();

  // Sección: "\d{3} NOMBRE-EN-MAYÚSCULAS" (evita agarrar 3 dígitos de en medio del NI).
  // Sin anclar a inicio de línea: al reconstruir líneas reales (hasEOL), el
  // valor de la sección suele compartir línea con el campo anterior (ej.
  // "DLR128089 330 SAN LUIS RIO COL..."), no empezarla.
  let secM = text.match(
    /SECCI[OÓ]N\s*ADUANERA\s*DE\s*DESPACHO:?[\s\S]{0,40}?(?<!\d)(\d{3})\s+[A-ZÁÉÍÓÚÑ]/i
  );
  if (!secM) secM = text.match(/(?<!\d)(\d{3})\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{3,}/);
  campos.seccion = secM
    ? secM[1].trim()
    : valorPorFila(items, /SECCI[OÓ]N\s*ADUANERA\s*DE\s*DESPACHO/i, /(\d{3})\s+[A-ZÁÉÍÓÚÑ]/);

  return campos;
}

export async function extraerCamposPdf(data: ArrayBuffer): Promise<PdfCampos> {
  try {
    const items = await extraerItems(data);
    return parseCamposTexto(reconstruirTexto(items), items);
  } catch {
    return { ...EMPTY };
  }
}
