// Carga perezosa de pdfjs-dist con el worker configurado una sola vez.
// Centralizado para que el render del QR (Scanner) y la extracción de texto
// (doda-pdf-campos) nunca diverjan de versión del worker.

type PdfjsLib = typeof import("pdfjs-dist");

let libPromise: Promise<PdfjsLib> | null = null;

export function getPdfjs(): Promise<PdfjsLib> {
  if (!libPromise) {
    libPromise = import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      return pdfjsLib;
    });
  }
  return libPromise;
}
