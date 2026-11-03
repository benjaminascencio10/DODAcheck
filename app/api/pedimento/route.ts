import { NextRequest, NextResponse } from "next/server";

// Validador oficial de pedimentos del SAT. El QR del pedimento trae esta URL
// completa como contenido — este endpoint la reenvía server-side (el
// navegador no puede hacer fetch cross-origin a un dominio .gob.mx) y
// parsea el HTML resultante.
const PEDIMENTO_HOST = "aplicacionesc.mat.sat.gob.mx";
const PEDIMENTO_PATH = "/SOIANET/oia_consultarapd_cep.aspx";

// Whitelist estricta de query params + formato — el endpoint recibe una URL
// completa controlada por el cliente, así que sin esto sería un proxy SSRF
// abierto (cualquiera podría pedirle a este servidor que haga fetch a
// cualquier host). Solo se acepta exactamente este host+path+params.
const PARAM_PATTERNS: Record<string, RegExp> = {
  pa: /^\d{1,6}$/,                 // patente
  dn: /^\d{1,10}$/,                // documento / número de pedimento
  s: /^\d{1,3}$/,                  // secuencia
  ap: /^\d{4}$/,                   // año
  pad: /^\d{3}$/,                  // clave de aduana
  ad: /^[A-Za-zÀ-ÿ0-9,.\s]{1,80}$/, // nombre de aduana (solo texto legible)
};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
};

function validatePedimentoUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname !== PEDIMENTO_HOST || url.pathname !== PEDIMENTO_PATH) return null;

  for (const [key, value] of url.searchParams.entries()) {
    const pattern = PARAM_PATTERNS[key];
    if (!pattern || !pattern.test(value)) return null;
  }
  // pa, dn y pad son los que se usan para reconstruir el pedimento — deben estar presentes.
  if (!url.searchParams.get("pa") || !url.searchParams.get("dn") || !url.searchParams.get("pad")) {
    return null;
  }
  return url;
}

// Extrae el texto de un <span id="...lblXxx"> tolerante a que el id venga
// con un prefijo de contenedor (típico de ASP.NET WebForms con
// MasterPage/ContentPlaceHolder) — confirmado contra la página renderizada,
// no contra el HTML crudo, así que se deja este margen a propósito.
function extractLabel(html: string, id: string): string | null {
  const re = new RegExp(`id=["'][^"']*${id}["'][^>]*>([^<]*)<`, "i");
  const m = html.match(re);
  if (!m) return null;
  const text = m[1].replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").trim();
  return text || null;
}

interface Movimiento {
  situacion: string;
  detalle: string;
  fecha: string;
}

function extractMovimientos(html: string): Movimiento[] {
  const tableMatch = html.match(/id=["'][^"']*grdSituacion["'][\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const rows = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const movimientos: Movimiento[] = [];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim()
    );
    if (cells.length < 3) continue; // fila de encabezado u otra cosa, no una fila de datos
    const [situacion, detalle, fecha] = cells;
    if (/^situaci/i.test(situacion)) continue; // encabezado
    movimientos.push({ situacion, detalle, fecha });
  }
  return movimientos;
}

async function fetchPedimento(url: URL) {
  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const html = await res.text();

  const aduanaNombre = extractLabel(html, "lblAduana");
  const patente = extractLabel(html, "lblPatente");
  const documento = extractLabel(html, "lblNumDcto");
  const tipoOperacion = extractLabel(html, "lblTipoOpe");
  const claveDocumento = extractLabel(html, "lblCveDcto");
  const numeroOperacion = extractLabel(html, "lblNumOper");
  const secuencia = extractLabel(html, "lblSecuencia");
  const factura = extractLabel(html, "lblFactura");
  const banco = extractLabel(html, "lblBanco");
  const movimientos = extractMovimientos(html);

  const ok = !!(aduanaNombre || patente || documento);
  return {
    ok,
    aduanaNombre,
    patente,
    documento,
    tipoOperacion,
    claveDocumento,
    numeroOperacion,
    secuencia,
    factura,
    banco,
    movimientos,
    // Reconstrucción confiable del pedimento: viene de la query string ya
    // validada, no del HTML (que solo trae el NOMBRE de la aduana, no su
    // clave de 3 dígitos).
    pad: url.searchParams.get("pad")!,
    pa: url.searchParams.get("pa")!,
    dn: url.searchParams.get("dn")!,
  };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Falta el parámetro url" }, { status: 400 });
  }

  const url = validatePedimentoUrl(raw);
  if (!url) {
    return NextResponse.json({ error: "URL de pedimento inválida" }, { status: 400 });
  }

  try {
    const data = await fetchPedimento(url);
    if (!data || !data.ok) {
      return NextResponse.json({ ok: false, error: "No se pudo leer el pedimento en el SAT" }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, error: "SAT no disponible" }, { status: 502 });
  }
}
