import { NextRequest, NextResponse } from "next/server";

// Scraping directo de la URL pública del validador del SAT — la misma que
// codifica el QR del DODA. Sin login, sin credenciales, sin backend propio.
const SAT_URLS = [
  "https://siat.sat.gob.mx/app/qr/faces/pages/mobile/validadorqr.jsf",
  "https://pecem.mat.sat.gob.mx/app/qr/ce/faces/pages/mobile/validadorqr.jsf",
];
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
};

// Código = Aduana (2 dígitos) + Sección (1 dígito) — Apéndice 1 SAT
const ADUANA_NAMES: Record<string, string> = {
  "010": "010 - Acapulco, Gro.",
  "012": "012 - Aeropuerto Acapulco, Gro.",
  "020": "020 - Agua Prieta, Son.",
  "050": "050 - Subteniente López, Q. Roo",
  "051": "051 - Chetumal, Q. Roo",
  "060": "060 - Cd. del Carmen, Camp.",
  "063": "063 - Seybaplaya, Camp.",
  "070": "070 - Ciudad Juárez, Chih.",
  "071": "071 - Puente Zaragoza-Isleta, Chih.",
  "072": "072 - San Jerónimo-Sta. Teresa, Chih.",
  "073": "073 - Aeropuerto Abraham González, Chih.",
  "074": "074 - Guadalupe-Tornillo, Chih.",
  "080": "080 - Coatzacoalcos, Ver.",
  "110": "110 - Ensenada, B.C.",
  "120": "120 - Guaymas, Son.",
  "121": "121 - Aeropuerto Hermosillo, Son.",
  "123": "123 - Cd. Obregón, Son.",
  "140": "140 - La Paz, B.C.S.",
  "142": "142 - San José del Cabo, B.C.S.",
  "143": "143 - Cabo San Lucas, B.C.S.",
  "144": "144 - Santa Rosalía, B.C.S.",
  "145": "145 - Loreto, B.C.S.",
  "147": "147 - Pichilingüe, B.C.S.",
  "160": "160 - Manzanillo, Col.",
  "161": "161 - Armería, Col.",
  "170": "170 - Matamoros, Tamps.",
  "171": "171 - Lucio Blanco-Los Indios, Tamps.",
  "172": "172 - Ferroviaria Matamoros, Tamps.",
  "180": "180 - Mazatlán, Sin.",
  "183": "183 - Topolobampo, Sin.",
  "184": "184 - Aeropuerto Culiacán, Sin.",
  "190": "190 - Mexicali, B.C.",
  "192": "192 - Los Algodones, B.C.",
  "193": "193 - San Felipe, B.C.",
  "200": "200 - Ciudad de México, CDMX",
  "202": "202 - Contenedores Azcapotzalco, CDMX",
  "220": "220 - Naco, Son.",
  "230": "230 - Nogales, Son.",
  "231": "231 - Sasabe, Son.",
  "240": "240 - Nuevo Laredo, Tamps.",
  "250": "250 - Ojinaga, Chih.",
  "260": "260 - Puerto Palomas, Chih.",
  "270": "270 - Piedras Negras, Coah.",
  "271": "271 - Aeropuerto Plan de Guadalupe, Coah.",
  "280": "280 - Progreso, Yuc.",
  "282": "282 - Aeropuerto Mérida, Yuc.",
  "300": "300 - Ciudad Reynosa, Tamps.",
  "302": "302 - Las Flores, Río Bravo, Tamps.",
  "304": "304 - Aeropuerto Reynosa, Tamps.",
  "305": "305 - Río Bravo-Donna, Tamps.",
  "306": "306 - Anzaldúas, Reynosa, Tamps.",
  "310": "310 - Salina Cruz, Oax.",
  "311": "311 - Aeropuerto Oaxaca, Oax.",
  "330": "330 - San Luis Río Colorado, Son.",
  "340": "340 - Cd. Miguel Alemán, Tamps.",
  "342": "342 - Guerrero, Tamps.",
  "370": "370 - Ciudad Hidalgo, Chis.",
  "372": "372 - Ciudad Talismán, Chis.",
  "375": "375 - Puerto Chiapas, Chis.",
  "376": "376 - Ciudad Cuauhtémoc, Chis.",
  "380": "380 - Tampico, Tamps.",
  "390": "390 - Tecate, B.C.",
  "400": "400 - Tijuana, B.C.",
  "402": "402 - Aeropuerto Tijuana, B.C.",
  "420": "420 - Tuxpan, Ver.",
  "421": "421 - Tuxpan (sección), Ver.",
  "430": "430 - Veracruz, Ver.",
  "432": "432 - Aeropuerto Veracruz, Ver.",
  "440": "440 - Ciudad Acuña, Coah.",
  "460": "460 - Torreón, Coah.",
  "461": "461 - Aeropuerto Torreón, Coah.",
  "462": "462 - Gómez Palacio, Dgo.",
  "463": "463 - Aeropuerto Guadalupe Victoria, Dgo.",
  "470": "470 - Aeropuerto CDMX (AICM)",
  "471": "471 - Satélite Aéreo AICM",
  "472": "472 - Centro Postal AICM",
  "480": "480 - Guadalajara, Jal.",
  "481": "481 - Puerto Vallarta, Jal.",
  "484": "484 - Intermodal Ferroviaria Guadalajara, Jal.",
  "500": "500 - Sonoyta, Son.",
  "501": "501 - San Emeterio, Son.",
  "510": "510 - Lázaro Cárdenas, Mich.",
  "511": "511 - Aeropuerto Ixtapa-Zihuatanejo, Gro.",
  "520": "520 - Monterrey, N.L.",
  "521": "521 - Aeropuerto Monterrey, N.L.",
  "523": "523 - Salinas Victoria A, N.L.",
  "524": "524 - General Escobedo, N.L.",
  "525": "525 - Salinas Victoria B, N.L.",
  "530": "530 - Cancún, Q. Roo",
  "532": "532 - Aeropuerto Cozumel, Q. Roo",
  "533": "533 - Puerto Morelos, Q. Roo",
  "640": "640 - Querétaro, Qro.",
  "647": "647 - Hidalgo (Atotonilco), Hgo.",
  "650": "650 - Toluca, Edo. Méx.",
  "651": "651 - San Cayetano Morelos, Edo. Méx.",
  "670": "670 - Chihuahua, Chih.",
  "671": "671 - Parque Ind. Las Américas, Chih.",
  "672": "672 - Aeropuerto Chihuahua, Chih.",
  "730": "730 - Aguascalientes, Ags.",
  "731": "731 - Interpuerto San Luis Potosí, S.L.P.",
  "732": "732 - Aeropuerto Zacatecas, Zac.",
  "733": "733 - Aeropuerto San Luis Potosí, S.L.P.",
  "734": "734 - La Pila-Villa, S.L.P.",
  "735": "735 - Aeropuerto Aguascalientes, Ags.",
  "750": "750 - Puebla, Pue.",
  "751": "751 - Cuernavaca, Mor.",
  "754": "754 - Aeropuerto Hermanos Serdán, Pue.",
  "800": "800 - Colombia, N.L.",
  "810": "810 - Altamira, Tamps.",
  "820": "820 - Cd. Camargo, Tamps.",
  "830": "830 - Dos Bocas, Tab.",
  "831": "831 - Aeropuerto Villahermosa, Tab.",
  "834": "834 - El Ceibo, Tab.",
  "840": "840 - Guanajuato (Silao), Gto.",
  "841": "841 - Celaya, Gto.",
  "842": "842 - Aeropuerto Guanajuato, Gto.",
};

function parseSatHtml(html: string) {
  let text = html.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ").trim();

  let estado: string | null = null;
  const estadoPatterns: [RegExp, string][] = [
    [/DESADUANAMIENTO\s*LIBRE/i, "DESADUANAMIENTOLIBRE"],
    [/RECONOCIMIENTO\s*ADUANERO[\s*]*CONCLUIDO/i, "RECONOCIMIENTO ADUANERO CONCLUIDO"],
    [/EN\s*RECONOCIMIENTO\s*ADUANERO/i, "EN RECONOCIMIENTO ADUANERO"],
    [/RECONOCIMIENTO\s*ADUANERO/i, "RECONOCIMIENTO ADUANERO"],
    [/SEGUNDO\s*RECONOCIMIENTO/i, "SEGUNDO RECONOCIMIENTO"],
    [/MODULACI[OÓ]N/i, "MODULACION"],
    [/DODA\s*no\s*presentado\s*al\s*Mecanismo/i, "DODA NO PRESENTADO"],
    [/no\s*presentado\s*al\s*Mecanismo\s*de\s*Selecci/i, "DODA NO PRESENTADO"],
    [/PREVIO/i, "PREVIO"],
    [/PENDIENTE/i, "PENDIENTE"],
  ];
  for (const [p, v] of estadoPatterns) if (p.test(text)) { estado = v; break; }
  if (/ha sido eliminado/i.test(text)) estado = "ELIMINADO";

  let aduana: string | null = null, patente: string | null = null, pedimento: string | null = null;
  const pedMatch = text.match(/(\d{3})-(\d{4})-(\d+(?:\/\d+)?)/);
  if (pedMatch) { aduana = pedMatch[1]; patente = pedMatch[2]; pedimento = `${pedMatch[1]}-${pedMatch[2]}-${pedMatch[3]}`; }

  // Fuente autoritativa: campo "Contenedores:" = N° Económico del vehículo
  // El token después de clave A1/A4 son las placas — nunca usar
  let trailer: string | null = null;
  const contMatch = text.match(/Contenedores?:\s*([A-Z0-9][A-Z0-9-]{2,19})/i);
  if (contMatch) trailer = contMatch[1];
  if (!trailer) { const c = text.match(/Candados?:\s*([A-Z0-9][A-Z0-9-]{2,19})/i); if (c) trailer = c[1]; }

  let fechaImpresion: string | null = null;
  const fImpM = text.match(/Impresi[oó]n.{0,80}?(\d{2})-(\d{2})-(\d{4})(?:[T\s]+(\d{2}:\d{2}(?::\d{2})?))?/i);
  if (fImpM) {
    fechaImpresion = `${fImpM[3]}-${fImpM[2]}-${fImpM[1]}`;
    if (fImpM[4]) fechaImpresion += ` ${fImpM[4]}`;
  }

  let fechaEmision: string | null = null;
  // Patrón 1: "Activación del Mecanismo... DD-MM-YYYY HH:MM:SS" (página SAT)
  const fM = text.match(/Activaci[oó]n.{0,80}?(\d{2})-(\d{2})-(\d{4})(?:[T\s]+(\d{2}:\d{2}(?::\d{2})?))?/i);
  if (fM) { fechaEmision = `${fM[3]}-${fM[2]}-${fM[1]}`; if (fM[4]) fechaEmision += ` ${fM[4]}`; }
  // Patrón 2: "FECHA DE EMISIÓN: YYYY-MM-DD HH:MM:SS" (documento impreso DODA)
  if (!fechaEmision) {
    const fE = text.match(/FECHA\s+DE\s+EMISI[OÓ]N[:\s]*(\d{4}-\d{2}-\d{2})(?:[T\s]+(\d{2}:\d{2}(?::\d{2})?))?/i);
    if (fE) { fechaEmision = fE[1]; if (fE[2]) fechaEmision += ` ${fE[2]}`; }
  }
  // Patrón 3: "FECHA DE EMISIÓN: DD-MM-YYYY HH:MM:SS"
  if (!fechaEmision) {
    const fE2 = text.match(/FECHA\s+DE\s+EMISI[OÓ]N[:\s]*(\d{2})-(\d{2})-(\d{4})(?:[T\s]+(\d{2}:\d{2}(?::\d{2})?))?/i);
    if (fE2) { fechaEmision = `${fE2[3]}-${fE2[2]}-${fE2[1]}`; if (fE2[4]) fechaEmision += ` ${fE2[4]}`; }
  }
  let tipoOperacion: string | null = null;
  const tM = text.match(/Tipo de Operaci[oó]n[:\s]+([A-Za-záéíóúÁÉÍÓÚ]+)/i);
  if (tM) tipoOperacion = tM[1].trim();

  let clavePedimento: string | null = null;
  const cM = text.match(/Clave de Pedimento[:\s]+([A-Z0-9]{1,6})/i);
  // Filter out false positives — valid claves are 1–6 alphanumeric chars (e.g. A1, A4, IN, RT)
  const INVALID_CLAVES = new Set(["DATOS", "NO", "SIN", "N/A", "NA"]);
  if (cM && !INVALID_CLAVES.has(cM[1].toUpperCase())) clavePedimento = cM[1].trim();

  let folioCFDI: string | null = null;
  const uM = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uM) folioCFDI = uM[0].toUpperCase();

  let seccionAduanera: string | null = null;
  const sM = text.match(/Secci[oó]n\s*Aduanera[:\s]+([^\n.]{3,60}?)(?:\s{2,}|$)/i);
  if (sM) seccionAduanera = sM[1].trim();
  else if (aduana) seccionAduanera = ADUANA_NAMES[aduana] ?? aduana;

  return { ok: estado !== null, estado, aduana, seccionAduanera, patente, pedimento, trailer, fechaImpresion, fechaEmision, tipoOperacion, clavePedimento, folioCFDI };
}

async function fetchViaSat(ni: string) {
  for (const base of SAT_URLS) {
    try {
      const res = await fetch(`${base}?D1=16&D2=1&D3=${encodeURIComponent(ni)}`, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return parseSatHtml(await res.text());
    } catch { /* try next */ }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const ni = req.nextUrl.searchParams.get("ni");
  if (!ni || !/^\d{7,12}$/.test(ni)) {
    return NextResponse.json({ error: "Número de integración inválido" }, { status: 400 });
  }

  const data = await fetchViaSat(ni);
  if (!data) return NextResponse.json({ ok: false, error: "SAT no disponible" }, { status: 502 });
  return NextResponse.json(data);
}
