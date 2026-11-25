import ExcelJS from 'exceljs';
import { COLUMNAS_NOTA, llenarPlantillaNotas, NotaContable, notaCuadrada } from './world-office-notas.util';

/** Plantilla con la misma estructura que la oficial de notas (encabezados, filas de ejemplo, «Listas» oculta). Datos sintéticos. */
async function plantillaSimulada(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [nombre, cols] of Object.entries(COLUMNAS_NOTA)) { const ws = wb.addWorksheet(nombre); ws.addRow(cols); ws.addRow(cols.map(() => 'EJEMPLO')); }
  const l = wb.addWorksheet('Listas'); l.state = 'hidden'; l.addRow(['Lista Forma de Pago']); l.addRow(['Efectivo']);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const NOTA: NotaContable = {
  empresa: 'EMPRESA PRUEBA', prefijo: 'AP', numero: 10, fecha: '2026-09-01', tercero: '900000001', concepto: 'ASUME PACIENTE', verificado: 'NO', anulado: 'NO',
  lineas: [
    { cuenta: '42559905', concepto: 'PACIENTE UNO - FISIOTERAPIA - ASUME PACIENTE', tercero: '111', debito: null, credito: 23100, centroCosto: 'Sura Póliza' },
    { cuenta: '13990501', concepto: 'PACIENTE UNO - FISIOTERAPIA - ASUME PACIENTE', tercero: '111', debito: 23100, credito: null, centroCosto: 'Sura Póliza' },
  ],
};

describe('Notas de contabilidad → plantilla oficial de World Office', () => {
  it('llena encabezado y detalle sin cambiar la estructura', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await llenarPlantillaNotas(await plantillaSimulada(), [NOTA]));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Encabezados', 'Detalles Contables', 'Listas']);
    const fila = (h: string, r: number) => (wb.getWorksheet(h)!.getRow(r).values as unknown[]).slice(1);
    expect(fila('Encabezados', 1)).toEqual(COLUMNAS_NOTA['Encabezados']);
    expect(fila('Encabezados', 2)).toEqual(['EMPRESA PRUEBA', 'AP', 10, new Date(Date.UTC(2026, 8, 1)), 900000001, 'ASUME PACIENTE', 'NO', 'NO']);
    expect(fila('Detalles Contables', 2).slice(0, 12)).toEqual(['EMPRESA PRUEBA', 'AP', 10, 42559905, 'PACIENTE UNO - FISIOTERAPIA - ASUME PACIENTE', 111, undefined, 23100, undefined, undefined, 'Sura Póliza', new Date(Date.UTC(2026, 8, 1))]);
    expect(fila('Detalles Contables', 3)[6]).toBe(23100);
    expect(wb.getWorksheet('Detalles Contables')!.getRow(4).hasValues).toBe(false);
  });

  it('verifica que cada nota cuadre (débitos = créditos)', () => {
    expect(notaCuadrada(NOTA)).toBe(true);
    expect(notaCuadrada({ ...NOTA, lineas: NOTA.lineas.slice(0, 1) })).toBe(false);
  });
});
