/**
 * Notas de contabilidad (asume paciente / asume entidad y sus reversiones) →
 * PLANTILLA OFICIAL de World Office: public/plantillas-wo/PlantillaNotasDeContabilidad.xlsx
 * (hojas «Encabezados» y «Detalles Contables», hoja oculta «Listas», firma «NC»).
 *
 * Igual que las demás plantillas: se abre el archivo oficial, se verifican los
 * encabezados, se borran solo las filas de ejemplo, se restaura la lista
 * desplegable y se conserva la firma. No se agregan, quitan ni renombran columnas.
 */
import ExcelJS from 'exceljs';
import { conservarFirmaPlantilla } from './plantilla-firma.util';
import { fechaExcel } from './world-office-plantillas.util';

export const RUTA_PLANTILLA_NOTAS = 'plantillas-wo/PlantillaNotasDeContabilidad.xlsx';

/** Encabezados exactos (fila 1) de la plantilla oficial de notas de contabilidad. */
export const COLUMNAS_NOTA: Record<string, string[]> = {
  'Encabezados': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Fecha *', 'Tercero*', 'Concepto *', 'Verificado', 'Anulado'],
  'Detalles Contables': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Codigo de Cuenta Contable *', 'Concepto del Movimiento Contable *',
    'Tercero Externo*', 'Débito *', 'Crédito *', 'Abona a', 'Abona a Documento', 'Nombre Centro de Costos', 'Fecha de Vencimiento *',
    'Base de Operación', 'Base de Retención', 'Porcentaje de Retención', 'Forma de Pago', 'Número de Documento Forma de Pago',
    'Fecha de Vencimiento Forma de Pago', 'Tercero Forma de Pago'],
};

export interface LineaNota {
  cuenta: string;
  concepto: string;
  tercero: string;
  debito: number | null;
  credito: number | null;
  centroCosto: string;
  /** Nombre del tercero (solo para pantalla y para revisar pacientes nuevos; no va a la plantilla). */
  nombre?: string;
}

export interface NotaContable {
  empresa: string;
  prefijo: string;
  numero: number;
  /** AAAA-MM-DD */
  fecha: string;
  tercero: string;
  concepto: string;
  verificado: 'SI' | 'NO';
  anulado: 'SI' | 'NO';
  lineas: LineaNota[];
}

const texto = (v: ExcelJS.CellValue): string => (v == null ? '' : typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') : String(v));
const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
const numeroOTexto = (s: string): string | number => (/^\d{1,15}$/.test(s) ? Number(s) : s);

function hojaVerificada(wb: ExcelJS.Workbook, nombre: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(nombre);
  if (!ws) throw new Error(`La plantilla de notas de World Office no tiene la hoja «${nombre}».`);
  COLUMNAS_NOTA[nombre].forEach((col, i) => {
    const real = texto(ws.getRow(1).getCell(i + 1).value);
    if (norm(real) !== norm(col)) throw new Error(`La plantilla de notas de World Office cambió: hoja «${nombre}», columna ${i + 1} es «${real}» y se esperaba «${col}».`);
  });
  for (let r = ws.rowCount; r >= 2; r--) ws.spliceRows(r, 1);
  return ws;
}

/** Débitos = créditos en cada nota (si no, World Office la rechaza). */
export function notaCuadrada(n: NotaContable): boolean {
  const d = n.lineas.reduce((s, l) => s + (l.debito || 0), 0);
  const c = n.lineas.reduce((s, l) => s + (l.credito || 0), 0);
  return Math.round(d * 100) === Math.round(c * 100) && d > 0;
}

/** Llena PlantillaNotasDeContabilidad.xlsx con las notas (una fila de encabezado por nota, una fila de detalle por línea). */
export async function llenarPlantillaNotas(plantilla: ArrayBuffer, notas: NotaContable[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(plantilla);
  const enc = hojaVerificada(wb, 'Encabezados');
  const det = hojaVerificada(wb, 'Detalles Contables');
  for (const n of notas) {
    const fecha = fechaExcel(n.fecha);
    const re = enc.addRow([n.empresa, n.prefijo, n.numero, fecha, numeroOTexto(n.tercero), n.concepto, n.verificado, n.anulado]);
    re.getCell(4).numFmt = 'dd/mm/yyyy';
    for (const l of n.lineas) {
      const rd = det.addRow([n.empresa, n.prefijo, n.numero, numeroOTexto(l.cuenta), l.concepto, numeroOTexto(l.tercero),
        l.debito || null, l.credito || null, null, null, l.centroCosto || null, fecha]);
      rd.getCell(12).numFmt = 'dd/mm/yyyy';
    }
  }
  // ExcelJS no conserva la lista desplegable «x14» de «Forma de Pago» (hoja oculta «Listas»): se recrea igual.
  (det as unknown as { dataValidations: { add(r: string, v: ExcelJS.DataValidation): void } })
    .dataValidations.add('P2:P65536', { type: 'list', allowBlank: true, showErrorMessage: true, formulae: ['Listas!$A$2:$A$9'] });
  return conservarFirmaPlantilla(plantilla, (await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
