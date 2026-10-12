import ExcelJS from 'exceljs';
import { CajaRecord } from '../models/records.model';
import { prepararDocumentos } from './world-office.util';
import { COLUMNAS_FACTURA, COLUMNAS_RECIBO, llenarPlantillaFactura, llenarPlantillaRecibo } from './world-office-plantillas.util';

/**
 * Las pruebas construyen en memoria una plantilla con la MISMA estructura que la
 * oficial (hojas, encabezados de la fila 1, filas de ejemplo y hoja oculta
 * «Listas»). Se usan datos sintéticos: el repositorio es público y no debe
 * contener reportes reales de caja (nombres y cédulas de pacientes).
 */
async function plantillaSimulada(hojas: Record<string, string[]>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [nombre, cols] of Object.entries(hojas)) {
    const ws = wb.addWorksheet(nombre);
    ws.addRow(cols);
    ws.getCell('A1').note = 'World Office Cloud: ayuda del campo';
    ws.addRow(cols.map(() => 'EJEMPLO'));
    ws.addRow(cols.map(() => 'EJEMPLO'));
  }
  const listas = wb.addWorksheet('Listas');
  listas.state = 'hidden';
  listas.addRow(['Nombre']);
  listas.addRow(['Efectivo']);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function fila(parcial: Partial<CajaRecord>): CajaRecord {
  return {
    nombre: '', id: '', documento: '', formaPago: '', items: '', itemsRaw: '', entidad: '',
    autorizacion: '', profesional: '', fecha: '2026-08-04', estado: 'F', valor: 0,
    caja: 'CAJA GENERAL', agendaTipo: '', sede: '', cotizante: '', regimen: '', detalleProf: '',
    noVerificacion: '', tipoDocumento: '', fechaRegistro: '2026-08-04 08:00:00', quienRegistra: '', servicioFecha: '',
    categoria: 'PAGO_NORMAL', esEntidad: false, tarifa: { tar: null, pac: null, ent: null, copagoExplicito: false, detectado: false, tipo: '', regla: '' },
    ...parcial,
  };
}

const CAJA: CajaRecord[] = [
  fila({ documento: 'R-100', id: '111', nombre: 'PACIENTE UNO', entidad: 'PARTICULARES', formaPago: 'EFECTIVO', valor: 32000, itemsRaw: 'FISIOTERAPIA PART 32.000' }),
  fila({ documento: 'COPL-7', id: '222', nombre: 'PACIENTE DOS', entidad: 'SEGUROS DE VIDA SURAMERICANA SA POLIZA 2024', formaPago: 'CREDITO-DEUDA', valor: 23100,
    itemsRaw: 'FISIOTERAPIA SURA POLIZA TAR 46.600 PAC 23.100 ENT 23.500' }),
  fila({ documento: 'COPG-9', id: '333', nombre: 'PACIENTE TRES', entidad: 'COOMEVA MEDICINA PREPAGADA SA 2024', formaPago: 'ANTICIPO DESCUENTO', valor: 20300, estado: 'A',
    itemsRaw: 'FISIOTERAPIA COOMEVA TAR 31.500 PAC 20.300 ENT 11.200' }),
  fila({ documento: 'ANTR-5', id: '444', nombre: 'PACIENTE CUATRO', entidad: 'ALLIANZ SEGUROS DE VIDA SA', formaPago: 'TARJETA', valor: 80000 }),
  fila({ documento: 'RCR-A-12', id: '555', nombre: 'PACIENTE CINCO', entidad: 'COOMEVA MEDICINA PREPAGADA SA 2024', formaPago: 'TRANSFERENCIA A BANCOLOMBIA REHABILITAR',
    valor: 19400, itemsRaw: 'ABONO DOCUMENTO R-90' }),
  fila({ documento: 'RCR-A-13', id: '666', formaPago: 'SIN VALOR', valor: 0 }),
];

const filas = (ws: ExcelJS.Worksheet) => {
  const out: unknown[][] = [];
  ws.eachRow((row, n) => { if (n > 1) out.push((row.values as unknown[]).slice(1)); });
  return out;
};

describe('Plantillas oficiales de World Office', () => {
  it('prepara facturas, recibos y excluidos con las reglas institucionales', () => {
    const p = prepararDocumentos(CAJA);
    expect(p.facturas.map((f) => f.documento)).toEqual(['R-100', 'COPL-7', 'COPG-9']);
    expect(p.recibos.map((r) => r.documento)).toEqual(['ANTR-5', 'RCR-A-12']);
    expect(p.excluidos.map((x) => x.documento)).toEqual(['RCR-A-13']);
    const deuda = p.recibos[1];
    expect(deuda.abonaA).toBe('FV R 90');
    expect(deuda.envioAPI).toBe(false);
    expect(deuda.concepto).toBe('PAGO DEUDA RCR-A-12');
    expect(deuda.avisos.join(' ')).toMatch(/más de 4 caracteres/);
    expect(p.controles.every((c) => c.ok)).toBe(true);
  });

  it('llena la plantilla de factura de venta sin cambiar su estructura', async () => {
    const p = prepararDocumentos(CAJA);
    const buf = await llenarPlantillaFactura(await plantillaSimulada(COLUMNAS_FACTURA), p.facturas);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Encabezados', 'Movimientos de Inventarios', 'Detalles del Pago', 'Listas']);
    expect(wb.getWorksheet('Listas')!.state).toBe('hidden');

    const enc = wb.getWorksheet('Encabezados')!;
    expect((enc.getRow(1).values as unknown[]).slice(1)).toEqual(COLUMNAS_FACTURA['Encabezados']);
    expect(enc.getCell('A1').note).toBeTruthy();
    const e = filas(enc);
    expect(e).toHaveLength(3);
    expect(e[0].slice(0, 8)).toEqual(['CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S', 'R', 100, new Date(Date.UTC(2026, 7, 4)), 32783738, 111, 'PAGO DEL DÍA', 'Efectivo']);
    expect(e[1][0]).toBe('LILIAN ROCIO ARRAZOLA BURBANO ');
    expect(e[1].slice(6, 8)).toEqual(['CREDITO-DEUDA', 'Crédito']);
    expect(e[2][11]).toBe('SI');
    expect(enc.getCell('D2').numFmt).toBe('dd/mm/yyyy');

    const mov = filas(wb.getWorksheet('Movimientos de Inventarios')!);
    expect(mov[0].slice(3, 12)).toEqual(['01', 'principal', 'und', 1, 0, 32000, 0, 'PAGO DEL DÍA', 'Particulares']);
    expect(mov[1][3]).toBe('05');
    expect(mov[1][11]).toBe('Sura Póliza');

    const pag = filas(wb.getWorksheet('Detalles del Pago')!);
    expect(pag.map((r) => r[4])).toEqual([32000, 23100, 20300]);
    expect(pag[0][3]).toBe('XEfectivo ');
  });

  it('llena la plantilla de recibo de caja con asientos cuadrados y «Abona A»', async () => {
    const p = prepararDocumentos(CAJA);
    const buf = await llenarPlantillaRecibo(await plantillaSimulada(COLUMNAS_RECIBO), p.recibos);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Encabezados', 'Detalles Contables', 'Listas']);

    const enc = filas(wb.getWorksheet('Encabezados')!);
    expect(enc.map((r) => r[5])).toEqual(['ANTICIPO ANTR-5', 'PAGO DEUDA RCR-A-12']);
    expect(enc[0][4]).toBe(444);

    const det = filas(wb.getWorksheet('Detalles Contables')!);
    expect(det).toHaveLength(4);
    expect(det.map((r) => [r[3], r[6] ?? null, r[7] ?? null])).toEqual([
      [11200505, 80000, null], [28051501, null, 80000], [11200506, 19400, null], [13050501, null, 19400],
    ]);
    expect(det[3][8]).toBe('FV R 90');
    const debitos = det.reduce((s, r) => s + Number(r[6] || 0), 0), creditos = det.reduce((s, r) => s + Number(r[7] || 0), 0);
    expect(debitos).toBe(creditos);
  });

  it('se detiene con un mensaje claro si la plantilla cambió', async () => {
    const cambiada = await plantillaSimulada({ ...COLUMNAS_RECIBO, 'Encabezados': ['Empresa *', 'Prefijo', 'Otra columna'] });
    await expect(llenarPlantillaRecibo(cambiada, [])).rejects.toThrow(/La plantilla de World Office cambió/);
  });
});
