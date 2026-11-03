// OCR de una foto del documento impreso (100% en el navegador, vía WASM —
// sin backend, sin API key). El texto que devuelve se parsea con la MISMA
// parseCamposTexto() que ya usa el flujo de PDF (doda-pdf-campos.ts) — el
// resto de la confrontación (confrontar-doda.ts) no distingue de dónde salió
// el texto impreso, solo lo compara contra el QR/cadena y el SAT.

/** Extrae el texto plano de una foto del DODA impreso. Best-effort: calidad
 *  de foto/luz afecta el resultado — un campo no reconocido simplemente no
 *  se compara (ver la "regla de oro" en confrontar-doda.ts). */
export async function extraerTextoFoto(file: File): Promise<string> {
  const { recognize } = await import("tesseract.js");
  const { data } = await recognize(file, "spa");
  return data.text;
}
