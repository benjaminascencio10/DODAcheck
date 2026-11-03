import { getPdfjs } from "./pdfjs";

// Elemento oculto reutilizado por html5-qrcode para decodificar un archivo
// (no una cámara en vivo). Debe existir en el DOM antes de llamar a esta
// función — ver <div id="qr-file-scanner-hidden" /> en Scanner.tsx.
const HIDDEN_SCANNER_ID = "qr-file-scanner-hidden";

/** Decodifica el QR de un archivo (PDF o imagen). html5-qrcode no lee un QR
 *  directo de un PDF, así que si el archivo es PDF se renderiza su primera
 *  página a PNG antes de escanear. */
export async function decodeQrFromFile(file: File): Promise<string> {
  let scanableFile = file;
  const esPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (esPdf) {
    const pdfjsLib = await getPdfjs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 }); // alta resolución para que el QR sea legible

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;

    const blob = await new Promise<Blob>((res) =>
      canvas.toBlob((b) => res(b!), "image/png")
    );
    scanableFile = new File([blob], "page1.png", { type: "image/png" });
  }

  const { Html5Qrcode } = await import("html5-qrcode");
  const scanner = new Html5Qrcode(HIDDEN_SCANNER_ID);
  const decoded = await scanner.scanFile(scanableFile, false);
  await scanner.clear();
  return decoded;
}
