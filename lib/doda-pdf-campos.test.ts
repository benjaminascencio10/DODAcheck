// node --test lib/doda-pdf-campos.test.ts   (Node 22.6+ type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCamposTexto, type PdfItem } from "./doda-pdf-campos.ts";

/** Simula reconstruirTexto(): concatena `str` sin separador, agrega "\n"
 *  donde el item real tendría hasEOL. Así los tests ejercitan exactamente
 *  lo que produce extraerCamposPdf() a partir de items posicionados. */
function textoDeItems(items: PdfItem[]): string {
  let out = "";
  for (const it of items) {
    out += it.str;
    if (it.hasEOL) out += "\n";
  }
  return out;
}

test("DODA simple: etiqueta y valor adyacentes en el texto → regex directo basta", () => {
  const text = [
    "No. DE INTEGRACIÓN: 145748085",
    "PATENTE O AUTORIZACIÓN: 3414",
    "CADENA ORIGINAL:",
    "||330|3414|1|6013156|145748085|500-3109|H02961|2026-06-16 11:04:51|",
  ].join("\n");
  const campos = parseCamposTexto(text);
  assert.equal(campos.numeroIntegracion, "145748085");
  assert.equal(campos.cadena?.numeroIntegracion, "145748085");
  assert.equal(campos.cadenaOriginal, "||330|3414|1|6013156|145748085|500-3109|H02961|2026-06-16 11:04:51|");
});

test("cadena original cierra con UN solo '|' (formato real del SAT) → se extrae igual", () => {
  // Antes de la corrección, el regex exigía cierre "||" y este formato
  // (el real, el mismo que produce doda-parser.ts) nunca matcheaba.
  const text = "CADENA ORIGINAL:\n||330|3414|1|6013156|145748085|500-3109|H02961|2026-06-16|";
  const campos = parseCamposTexto(text);
  assert.equal(campos.cadenaOriginal, "||330|3414|1|6013156|145748085|500-3109|H02961|2026-06-16|");
  assert.equal(campos.cadena?.numeroIntegracion, "145748085");
});

test("PDF con etiquetas y valores en bloques separados del content stream (layout real del SAT): " +
  "el NI llega partido en dos items ('145748'+'112') lejos de su etiqueta — se recupera por posición (misma fila)", () => {
  // Reproduce el layout observado con pdfjs-dist en un DODA real: el
  // generador dibuja TODAS las etiquetas de la tabla en un bloque, y TODOS
  // los valores llenados en otro bloque aparte — no quedan adyacentes en
  // el texto, pero comparten la altura (y) de su fila.
  const items: PdfItem[] = [
    // ── bloque de etiquetas ──
    { str: "No. DE INTEGRACIÓN:", x: 26, y: 719.28, hasEOL: false },
    { str: " ", x: 113, y: 719.28, hasEOL: false },
    { str: "PATENTE O AUTORIZACIÓN:", x: 280, y: 719.28, hasEOL: true },
    { str: "SECCIÓN ADUANERA DE", x: 343, y: 662.4, hasEOL: true },
    { str: "DESPACHO:", x: 368, y: 653.4, hasEOL: false },
    // ── bloque de valores, aparte y lejos en el texto ──
    { str: "145748", x: 123, y: 718.68, hasEOL: false }, // mismo renglón que el label del NI (±0.6pt)
    { str: "112", x: 152.9, y: 718.68, hasEOL: true },
    { str: "DLR128089", x: 31, y: 629.4, hasEOL: false },
    { str: " ", x: 79, y: 629.4, hasEOL: false },
    { str: "330 SAN LUIS RIO COL", x: 338, y: 630.12, hasEOL: true },
    { str: "CADENA ORIGINAL:", x: 28, y: 576.6, hasEOL: true },
    { str: "||330|3414|1|6013156-COVE2685GGHJ5|145748085|28488F|9706R|2026-08-28 04:54:12|", x: 28, y: 564.24, hasEOL: true },
  ];
  const campos = parseCamposTexto(textoDeItems(items), items);

  // El regex de texto (adyacencia) NO encuentra el NI aquí — solo el
  // refuerzo por posición lo hace. Si esto rompe, es porque el fallback
  // por fila dejó de funcionar.
  assert.equal(campos.numeroIntegracion, "145748112");
  assert.equal(campos.cadena?.numeroIntegracion, "145748085");
  assert.equal(campos.seccion, "330");

  // La discrepancia real que motivó este fix: el NI impreso no es el NI
  // de la cadena/QR del mismo documento.
  assert.notEqual(campos.numeroIntegracion, campos.cadena?.numeroIntegracion);
});

test("etiqueta lejos del valor en el texto Y en Y (otra fila) → numeroIntegracion queda null (no inventa nada)", () => {
  const items: PdfItem[] = [
    { str: "No. DE INTEGRACIÓN:", x: 26, y: 719.28, hasEOL: true },
    { str: "PATENTE O AUTORIZACIÓN:", x: 280, y: 719.28, hasEOL: true }, // rompe la adyacencia de texto (>1 \n)
    { str: "145748112", x: 123, y: 400, hasEOL: true }, // y muy lejos en Y — otra fila, no matchea por posición
  ];
  const campos = parseCamposTexto(textoDeItems(items), items);
  assert.equal(campos.numeroIntegracion, null);
});

test("hasEOL respetado al reconstruir texto: un número partido en la MISMA línea se rejunta", () => {
  // Antes de la corrección, extraerTexto() insertaba "\n" entre CADA item
  // sin mirar hasEOL, partiendo "145748"+"112" en dos líneas y rompiendo
  // el regex de adyacencia incluso cuando la etiqueta SÍ estaba cerca.
  const items: PdfItem[] = [
    { str: "No. DE INTEGRACIÓN: ", x: 26, y: 719, hasEOL: false },
    { str: "145748", x: 123, y: 719, hasEOL: false },
    { str: "112", x: 153, y: 719, hasEOL: true },
  ];
  const text = textoDeItems(items);
  assert.equal(text, "No. DE INTEGRACIÓN: 145748112\n");
  const campos = parseCamposTexto(text, items);
  assert.equal(campos.numeroIntegracion, "145748112");
});
