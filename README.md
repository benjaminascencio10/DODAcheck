# DODAScanner

Herramienta independiente y de código abierto para verificar la legalidad de un **DODA** (Documento de Operación para Despacho Aduanero, México) a partir de:

- **PDF** del documento digital.
- **Número de Integración (NI)**.
- **Foto** del documento impreso (OCR en el navegador).

No es software oficial del SAT — es una herramienta de verificación independiente pensada para que cualquier broker, agente aduanal o línea de transporte la integre a su propio TMS o proceso interno.

## Cómo funciona

1. Se decodifica el código QR del DODA (por cámara, por archivo subido, o se renderiza la primera página del PDF para leerlo).
2. Se lee el texto impreso del documento — desde el propio PDF, o vía OCR si es una foto.
3. Se consulta el estado oficial del NI directamente en la página pública del validador del SAT (la misma URL que codifica el QR — sin login, sin credenciales).
4. Se **confrontan tres fuentes independientes**: el QR, la "cadena original" impresa, y el texto humano legible — contra el SAT. Un DODA falso típico altera el texto visible pero deja el QR/cadena intactos; esta comparación lo revela.

Toda la lógica corre **100% en el navegador** (incluido el OCR, vía [Tesseract.js](https://github.com/naptha/tesseract.js) con WASM) salvo la única llamada de red a la URL pública del SAT (`app/api/doda/route.ts`) — no hay backend propio, no hay base de datos, no hay cuentas de usuario.

## Uso local

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Integrarlo a un TMS

- **Como página independiente**: despliega este repo (Vercel, o cualquier host de Next.js) y enlaza `https://tu-dominio/?ni=1234567890` para precargar una consulta por NI.
- **Como referencia de integración**: la lógica de verificación (`lib/confrontar-doda.ts`, `lib/doda-pdf-campos.ts`, `lib/doda-parser.ts`, `lib/ocr.ts`) es pura TypeScript sin dependencias de UI — se puede importar directamente en otro proyecto, o usar `app/api/doda/route.ts` como referencia para tu propio endpoint de consulta al SAT.

## Limitaciones conocidas

- El OCR de fotos es *best-effort*: la calidad de la foto y la iluminación afectan el reconocimiento. Un campo no reconocido simplemente no se compara (nunca se reporta como discrepancia un campo vacío).
- La consulta al SAT depende de que las páginas públicas del validador (`siat.sat.gob.mx`, `pecem.mat.sat.gob.mx`) estén disponibles y no cambien su estructura HTML.
- Esta herramienta no sustituye la validación de tu agente aduanal.

## Licencia

MIT — ver [LICENSE](./LICENSE).
