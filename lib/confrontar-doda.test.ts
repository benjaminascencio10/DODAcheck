// node --test lib/confrontar-doda.test.ts   (Node 22.6+ type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { confrontarDoda, tieneCritico, confrontarPedimento } from "./confrontar-doda.ts";

type AnyResult = Parameters<typeof confrontarDoda>[0]["qr"];
type AnySat = Parameters<typeof confrontarDoda>[0]["satData"];

const cadenaQr = (over: Partial<Record<string, string>> = {}): AnyResult =>
  ({
    type: "cadena",
    raw: "",
    fields: {
      seccion: "330",
      patente: "3414",
      totalPedimentos: "1",
      pedimentos: "6013156",
      numeroIntegracion: "145748085",
      placa: "500-3109",
      contenedor: "H02961",
      fecha: "2026-06-16 11:04:51",
      ...over,
    },
  }) as AnyResult;

const urlQr = (ni = "145748085"): AnyResult =>
  ({ type: "sat-url", raw: "", numeroIntegracion: ni, satUrl: "" }) as AnyResult;

const sat = (over: Partial<Record<string, unknown>> = {}): AnySat =>
  ({
    ok: true,
    estado: "RECONOCIMIENTO ADUANERO CONCLUIDO",
    aduana: "330",
    seccionAduanera: "330 - Ciudad Reynosa, Tamps.",
    patente: "3414",
    pedimento: "330-3414-6013156/1",
    trailer: null,
    fechaImpresion: null,
    fechaEmision: "2026-06-16 11:04:51",
    fechaCruce: null,
    tipoOperacion: "Exportación",
    clavePedimento: "RT",
    folioCFDI: null,
    ...over,
  }) as AnySat;

type AnyPdf = NonNullable<Parameters<typeof confrontarDoda>[0]["pdfCampos"]>;
const pdf = (over: Partial<AnyPdf> = {}): AnyPdf =>
  ({
    cadenaOriginal: "||330|3414|1|6013156|145748085|500-3109|H02961|2026-06-16||",
    cadena: {
      seccion: "330", patente: "3414", totalPedimentos: "1", pedimentos: "6013156",
      numeroIntegracion: "145748085", placa: "500-3109", contenedor: "H02961", fecha: "2026-06-16",
    },
    numeroIntegracion: "145748085",
    patente: "3414",
    pedimentos: "330-3414-6013156/1",
    seccion: null,
    ...over,
  }) as AnyPdf;

test("documento sano → sin discrepancias", () => {
  assert.deepEqual(confrontarDoda({ qr: cadenaQr(), satData: sat() }), []);
});

test("patente distinta → crítico", () => {
  const d = confrontarDoda({ qr: cadenaQr({ patente: "9999" }), satData: sat() });
  assert.equal(d.length, 1);
  assert.equal(d[0].campo, "patente");
  assert.equal(d[0].severidad, "critico");
  assert.ok(tieneCritico(d));
});

test("patente con ceros a la izquierda NO es discrepancia", () => {
  const d = confrontarDoda({ qr: cadenaQr({ patente: "03414" }), satData: sat() });
  assert.deepEqual(d, []);
});

test("pedimento: progresivo distinto → crítico", () => {
  const d = confrontarDoda({ qr: cadenaQr({ pedimentos: "9999999" }), satData: sat() });
  assert.equal(d.some((x) => x.campo === "pedimento" && x.severidad === "critico"), true);
});

test("pedimento: mismo progresivo con formato distinto NO es discrepancia", () => {
  const d = confrontarDoda({ qr: cadenaQr({ pedimentos: "6013156" }), satData: sat({ pedimento: "330-3414-6013156/1" }) });
  assert.deepEqual(d, []);
});

test("consolidado (totalPedimentos>1) → se salta el chequeo de pedimento", () => {
  const d = confrontarDoda({
    qr: cadenaQr({ totalPedimentos: "6", pedimentos: "0000001" }),
    satData: sat(),
  });
  assert.equal(d.some((x) => x.campo === "pedimento"), false);
});

test("sección aduanera distinta → crítico", () => {
  const d = confrontarDoda({ qr: cadenaQr({ seccion: "240" }), satData: sat({ aduana: "330" }) });
  assert.equal(d.some((x) => x.campo === "seccionAduanera" && x.severidad === "critico"), true);
});

test("NO marca sección cuando el 'valor' es en realidad parte del NI (regresión)", () => {
  // parser degradado que dejó los primeros 3 díg del NI como sección
  const d = confrontarDoda({
    qr: urlQr("145748085"),
    satData: sat({ aduana: "330" }),
    pdfCampos: {
      cadenaOriginal: null, cadena: null, numeroIntegracion: "145748085",
      patente: "3414", pedimentos: "330-3414-6013156/1", seccion: "145", fechaEmision: null,
    },
  });
  assert.equal(d.length, 0, JSON.stringify(d));
});

test("sección se deriva del prefijo del pedimento impreso, no del texto suelto", () => {
  const d = confrontarDoda({
    qr: urlQr("145748085"),
    satData: sat({ aduana: "240" }),   // SAT dice 240, el pedimento del doc dice 330
    pdfCampos: {
      cadenaOriginal: null, cadena: null, numeroIntegracion: "145748085",
      patente: "3414", pedimentos: "330-3414-6013156/1", seccion: null, fechaEmision: null,
    },
  });
  const s = d.find((x) => x.campo === "seccionAduanera");
  assert.ok(s, "debe marcar sección");
  assert.equal(s!.valorDocumento, "330");
  assert.equal(s!.valorReferencia, "240");
});

test("papel alterado: patente impresa ≠ QR/SAT (QR intacto) → crítico", () => {
  const d = confrontarDoda({
    qr: cadenaQr({ patente: "3414" }),         // QR trae el dato real
    satData: sat({ patente: "3414" }),         // SAT coincide con el QR
    pdfCampos: pdf({ patente: "9999" }),        // el texto impreso fue alterado
  });
  const p = d.find((x) => x.campo === "patente");
  assert.ok(p, "debe marcar patente: " + JSON.stringify(d));
  assert.equal(p!.valorDocumento, "9999");
  assert.ok(tieneCritico(d));
});

test("papel alterado: pedimento impreso ≠ QR/SAT → crítico", () => {
  const d = confrontarDoda({
    qr: cadenaQr({ pedimentos: "6013156" }),
    satData: sat({ pedimento: "330-3414-6013156/1" }),
    pdfCampos: pdf({ pedimentos: "330-3414-9999999/1" }),
  });
  assert.ok(d.some((x) => x.campo === "pedimento" && x.valorDocumento === "330-3414-9999999/1"));
});

test("papel alterado: aduana impresa (prefijo del pedimento) ≠ SAT → crítico", () => {
  const d = confrontarDoda({
    qr: cadenaQr(),
    satData: sat({ aduana: "330" }),
    pdfCampos: pdf({ pedimentos: "240-3414-6013156/1" }),  // impreso dice aduana 240
  });
  assert.ok(d.some((x) => x.campo === "seccionAduanera" && x.valorDocumento === "240"));
});

test("documento sano CON pdfCampos (cadena+texto coinciden con SAT) → sin discrepancias", () => {
  assert.deepEqual(confrontarDoda({ qr: cadenaQr(), satData: sat(), pdfCampos: pdf() }), []);
});

test("SAT no disponible → sin discrepancias", () => {
  assert.deepEqual(confrontarDoda({ qr: cadenaQr({ patente: "9999" }), satData: null }), []);
  assert.deepEqual(
    confrontarDoda({ qr: cadenaQr({ patente: "9999" }), satData: sat({ ok: false, estado: null }) }),
    []
  );
});

test("campo del SAT ausente (null) → no se confronta ese campo", () => {
  const d = confrontarDoda({ qr: cadenaQr({ patente: "9999" }), satData: sat({ patente: null }) });
  assert.equal(d.some((x) => x.campo === "patente"), false);
});

test("estado NO ENCONTRADO → crítico numeroIntegracion 'no registrado', sin más", () => {
  const d = confrontarDoda({
    qr: cadenaQr({ patente: "9999" }),
    satData: sat({ estado: "NO ENCONTRADO", ok: true }),
  });
  assert.equal(d.length, 1);
  assert.equal(d[0].campo, "numeroIntegracion");
  assert.equal(d[0].valorReferencia, "no registrado");
});

test("NI impreso ≠ NI del QR → crítico (fuente qr)", () => {
  const d = confrontarDoda({
    qr: urlQr("145748085"),
    satData: null,
    pdfCampos: {
      cadenaOriginal: null,
      cadena: null,
      numeroIntegracion: "999999999",
      patente: null,
      pedimentos: null,
      seccion: null,
      fechaEmision: null,
    },
  });
  assert.equal(d.length, 1);
  assert.equal(d[0].campo, "numeroIntegracion");
  assert.equal(d[0].fuenteReferencia, "qr");
});

test("QR solo-URL + PDF con campos: confronta el PDF contra el SAT", () => {
  const d = confrontarDoda({
    qr: urlQr("145748085"),
    satData: sat(),
    pdfCampos: {
      cadenaOriginal: null,
      cadena: null,
      numeroIntegracion: "145748085",
      patente: "9999",
      pedimentos: null,
      seccion: null,
      fechaEmision: null,
    },
  });
  assert.equal(d.some((x) => x.campo === "patente" && x.severidad === "critico"), true);
});

// ── confrontarPedimento() — QR del Pedimento vs el SAT del DODA ────────────
// Valores reales de la captura que mandó el usuario: pa=3908, dn=6003325, pad=170
// → pedimento reconstruido "170-3908-6003325".

test("pedimento del QR coincide con el SAT → sin discrepancias", () => {
  const d = confrontarPedimento({
    pedimentoQr: { pad: "170", pa: "3908", dn: "6003325" },
    satData: sat({ pedimento: "170-3908-6003325", aduana: "170" }),
  });
  assert.deepEqual(d, []);
});

test("pedimento del QR distinto al SAT → crítico", () => {
  const d = confrontarPedimento({
    pedimentoQr: { pad: "170", pa: "3908", dn: "6003325" },
    satData: sat({ pedimento: "330-3414-6013156/1", aduana: "170" }),
  });
  assert.equal(d.some((x) => x.campo === "pedimento" && x.fuenteReferencia === "pedimento-qr" && x.severidad === "critico"), true);
});

test("aduana del QR distinta a la del SAT → crítico", () => {
  const d = confrontarPedimento({
    pedimentoQr: { pad: "170", pa: "3908", dn: "6003325" },
    satData: sat({ pedimento: "170-3908-6003325", aduana: "330" }),
  });
  assert.equal(d.some((x) => x.campo === "seccionAduanera" && x.fuenteReferencia === "pedimento-qr"), true);
});

test("sin satData → sin discrepancias (nada que confrontar)", () => {
  assert.deepEqual(
    confrontarPedimento({ pedimentoQr: { pad: "170", pa: "3908", dn: "6003325" }, satData: null }),
    []
  );
});

test("satData.pedimento ausente → no inventa discrepancia (regla de oro)", () => {
  const d = confrontarPedimento({
    pedimentoQr: { pad: "170", pa: "3908", dn: "6003325" },
    satData: sat({ pedimento: null, aduana: null }),
  });
  assert.deepEqual(d, []);
});
