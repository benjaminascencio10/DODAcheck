export interface CadenaFields {
  seccion: string;
  patente: string;
  totalPedimentos: string;
  pedimentos: string;
  numeroIntegracion: string;
  placa: string;
  contenedor: string;
  fecha: string;
}

export type DodaResult =
  | {
      type: "sat-url";
      numeroIntegracion: string;
      satUrl: string;
      raw: string;
    }
  | {
      type: "cadena";
      fields: CadenaFields;
      raw: string;
    }
  | {
      type: "unknown";
      raw: string;
    };

const SAT_QR_PATTERN =
  /validadorqr\.jsf\?D1=(\d+)&D2=(\d+)&D3=([A-Za-z0-9]+)/i;

const CADENA_PATTERN = /^\|\|(.+?)(?:\|\|)?$/;

export function parseQrContent(raw: string): DodaResult {
  const trimmed = raw.trim();

  // SAT validator URL: https://siat.sat.gob.mx/...?D1=16&D2=1&D3={NI}
  const urlMatch = trimmed.match(SAT_QR_PATTERN);
  if (urlMatch) {
    return {
      type: "sat-url",
      numeroIntegracion: urlMatch[3],
      satUrl: trimmed,
      raw: trimmed,
    };
  }

  // Cadena original: ||seccion|patente|totalPedimentos|pedimentos|NI|placa|contenedor|fecha||
  const cadenaMatch = trimmed.match(CADENA_PATTERN);
  if (cadenaMatch) {
    const parts = cadenaMatch[1].split("|");
    if (parts.length >= 8) {
      return {
        type: "cadena",
        fields: {
          seccion: parts[0] ?? "",
          patente: parts[1] ?? "",
          totalPedimentos: parts[2] ?? "",
          pedimentos: parts[3] ?? "",
          numeroIntegracion: parts[4] ?? "",
          placa: parts[5] ?? "",
          contenedor: parts[6] ?? "",
          fecha: parts[7] ?? "",
        },
        raw: trimmed,
      };
    }
  }

  return { type: "unknown", raw: trimmed };
}

export function buildSatUrl(numeroIntegracion: string): string {
  return `https://siat.sat.gob.mx/app/qr/faces/pages/mobile/validadorqr.jsf?D1=16&D2=1&D3=${numeroIntegracion}`;
}

export function getNumeroIntegracion(result: DodaResult): string | null {
  if (result.type === "sat-url") return result.numeroIntegracion;
  if (result.type === "cadena") return result.fields.numeroIntegracion || null;
  return null;
}
