// Reconoce el QR de un Pedimento (documento aduanal distinto al DODA).
// El QR trae la URL completa del validador oficial del SAT, con todos los
// datos como query string — no hay nada que decodificar aquí, solo
// reconocer el host/path exactos. La validación estricta de los parámetros
// (y la defensa contra SSRF) vive en app/api/pedimento/route.ts, que es
// quien de verdad hace el fetch.

export type PedimentoQrResult =
  | { type: "pedimento-url"; url: string }
  | { type: "unknown" };

const PEDIMENTO_HOST = "aplicacionesc.mat.sat.gob.mx";
const PEDIMENTO_PATH = "/SOIANET/oia_consultarapd_cep.aspx";

export function parsePedimentoQr(raw: string): PedimentoQrResult {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname === PEDIMENTO_HOST && url.pathname === PEDIMENTO_PATH) {
      return { type: "pedimento-url", url: trimmed };
    }
  } catch {
    // no era una URL válida
  }
  return { type: "unknown" };
}
