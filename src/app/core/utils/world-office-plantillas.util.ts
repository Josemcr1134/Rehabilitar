/**
 * Llenado de las PLANTILLAS OFICIALES de World Office:
 *   - public/plantillas-wo/PlantillaFacturaVentaDatosMonedaLocal.xlsx
 *       hojas «Encabezados», «Movimientos de Inventarios», «Detalles del Pago»
 *   - public/plantillas-wo/PlantillaRecibosDeCaja_1.xlsx
 *       hojas «Encabezados», «Detalles Contables»
 *
 * Se abre el archivo oficial y solo se reemplazan sus filas de ejemplo: no se
 * agregan, quitan ni renombran columnas, y se conservan los comentarios de
 * ayuda de los encabezados y la hoja oculta «Listas». Antes de escribir se
 * verifica que los encabezados sean los esperados: si World Office cambia su
 * plantilla, falla con un mensaje claro en vez de llenar columnas corridas.
 *
 * Funciones puras (sin Angular): reciben la plantilla como ArrayBuffer y
 * devuelven el .xlsx llenado como ArrayBuffer.
 */
import ExcelJS from 'exceljs';
import { FacturaWO, ReciboWO, WO_CONFIG } from '../models/world-office.model';

export const RUTA_PLANTILLA_FACTURA = 'plantillas-wo/PlantillaFacturaVentaDatosMonedaLocal.xlsx';
export const RUTA_PLANTILLA_RECIBO = 'plantillas-wo/PlantillaRecibosDeCaja_1.xlsx';

/** Encabezados exactos de las plantillas oficiales (fila 1 de cada hoja). */
export const COLUMNAS_FACTURA: Record<string, string[]> = {
  'Encabezados': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Fecha *', 'Vendedor *', 'Cliente *', 'Concepto *', 'Forma de Pago *',
    'Fecha de Vencimiento *', 'Fecha de Entrega', 'Verificado', 'Anulado', 'Dirección Sucursal', 'Clasificación', 'Contacto', 'Exportación'],
  'Movimientos de Inventarios': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Producto *', 'Bodega *', 'Unidad de Medida *', 'Cantidad *',
    'IVA *', 'Valor Unitario *', 'Descuento *', 'Nota', 'Centro costos', 'Meses a Diferir', 'ImpoConsumo-Advalorem', 'ImpoConsumo-Bolsas',
    'ImpoConsumo-Distrital', 'ImpoConsumo-Nacional', 'Impuesto Nacional a la Gasolina y ACPM', 'ImpoConsumo-Advalorem- Porcentaje',
    'ImpSaludable Alimentos Ultraprocesados', 'ImpSaludable Bebidas Azucaradas', 'Tercero del Detalle'],
  'Detalles del Pago': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Forma de Pago *', ' Valor *', 'Banco / Entidad', 'Número Transacción ',
    'Franquicia', 'Fecha'],
};
export const COLUMNAS_RECIBO: Record<string, string[]> = {
  'Encabezados': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Fecha *', 'Recibo de*', 'Concepto *', 'Verificado', 'Anulado',
    'Fecha de Recaudo', 'Recaudado por'],
  'Detalles Contables': ['Empresa *', 'Prefijo', 'Número de Documento *', 'Codigo de Cuenta Contable*', 'Concepto del Movimiento Contable*',
    'Tercero Externo*', 'Débito*', 'Crédito*', 'Abona A', 'Abona a Documento', 'Nombre Centro de Costos', 'Fecha de Vencimiento',
    'Base de Operación', 'Base de Retención', 'Porcentaje de Retención', 'Forma de Pago', 'Número de documento Forma de Pago',
    'Fecha de Vencimiento Forma de Pago', 'Tercero Forma de Pago'],
};

/** 'YYYY-MM-DD' → Date (UTC) para que Excel la guarde como fecha real, con formato dd/mm/aaaa como pide la plantilla. */
export function fechaExcel(s: string): Date | null {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

const texto = (v: ExcelJS.CellValue): string => (v == null ? '' : typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') : String(v));

/** Verifica los encabezados de la hoja oficial y borra sus filas de ejemplo (deja intacta la fila 1). */
function hojaVerificada(wb: ExcelJS.Workbook, nombre: string, columnas: string[]): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(nombre);
  if (!ws) throw new Error(`La plantilla de World Office no tiene la hoja «${nombre}».`);
  columnas.forEach((col, i) => {
    const real = texto(ws.getRow(1).getCell(i + 1).value);
    if (real.trim() !== col.trim()) {
      throw new Error(`La plantilla de World Office cambió: hoja «${nombre}», columna ${i + 1} es «${real}» y se esperaba «${col}».`);
    }
  });
  for (let r = ws.rowCount; r >= 2; r--) ws.spliceRows(r, 1);
  return ws;
}

function escribir(ws: ExcelJS.Worksheet, valores: unknown[], colsFecha: number[] = [], colsTexto: number[] = []): void {
  const row = ws.addRow(valores);
  colsFecha.forEach((c) => { if (row.getCell(c).value) row.getCell(c).numFmt = 'dd/mm/yyyy'; });
  colsTexto.forEach((c) => { row.getCell(c).numFmt = '@'; });
}

/**
 * ExcelJS no conserva las listas desplegables «x14» de las plantillas oficiales
 * (las que apuntan a la hoja oculta «Listas»): se vuelven a crear con el mismo
 * rango y la misma lista.
 */
function restaurarLista(ws: ExcelJS.Worksheet, rango: string, formula: string): void {
  (ws as unknown as { dataValidations: { add(r: string, v: ExcelJS.DataValidation): void } })
    .dataValidations.add(rango, { type: 'list', allowBlank: true, showErrorMessage: true, formulae: [formula] });
}

/** Llena PlantillaFacturaVentaDatosMonedaLocal.xlsx con las facturas preparadas. */
export async function llenarPlantillaFactura(plantilla: ArrayBuffer, facturas: FacturaWO[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(plantilla);
  const enc = hojaVerificada(wb, 'Encabezados', COLUMNAS_FACTURA['Encabezados']);
  const mov = hojaVerificada(wb, 'Movimientos de Inventarios', COLUMNAS_FACTURA['Movimientos de Inventarios']);
  const pag = hojaVerificada(wb, 'Detalles del Pago', COLUMNAS_FACTURA['Detalles del Pago']);
  for (const f of facturas) {
    escribir(enc, [f.empresa, f.prefijoWO, f.numero, fechaExcel(f.fecha), Number(WO_CONFIG.vendedorIdentificacion), Number(f.cliente),
      f.concepto, f.formaPagoWO, fechaExcel(f.fecha), null, 'SI', f.anulado ? 'SI' : 'NO'], [4, 9]);
    escribir(mov, [f.empresa, f.prefijoWO, f.numero, String(f.producto), WO_CONFIG.bodega, WO_CONFIG.unidadMedida, f.cantidad, 0,
      f.valorUnitario, 0, f.concepto, f.centroCosto], [], [4]);
    f.pagos.forEach((pg) => escribir(pag, [f.empresa, f.prefijoWO, f.numero, pg.forma, pg.valor]));
  }
  restaurarLista(pag, `D2:D${Math.max(101, pag.rowCount + 100)}`, 'Listas!$A$2:$A$80');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Llena PlantillaRecibosDeCaja_1.xlsx con los recibos preparados (anticipos y abonos a deuda). */
export async function llenarPlantillaRecibo(plantilla: ArrayBuffer, recibos: ReciboWO[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(plantilla);
  const enc = hojaVerificada(wb, 'Encabezados', COLUMNAS_RECIBO['Encabezados']);
  const det = hojaVerificada(wb, 'Detalles Contables', COLUMNAS_RECIBO['Detalles Contables']);
  for (const r of recibos) {
    escribir(enc, [r.empresa, r.prefijoWO, r.numero, fechaExcel(r.fecha), Number(r.cliente), r.concepto, 'SI', r.anulado ? 'SI' : 'NO',
      fechaExcel(r.fecha)], [4, 9]);
    for (const a of r.asientos) {
      // «Forma de Pago» solo para las cuentas de caja/banco (los débitos), como indica la plantilla.
      const fp = a.naturaleza === 'D' && a.forma ? WO_CONFIG.formaPagoContable[a.forma] : null;
      escribir(det, [r.empresa, r.prefijoWO, r.numero, Number(a.cuenta), r.concepto, Number(r.cliente),
        a.naturaleza === 'D' ? a.valor : null, a.naturaleza === 'C' ? a.valor : null, a.abonaA || null, null,
        r.centroCosto || null, fechaExcel(r.fecha), null, null, null, fp || null], [12]);
    }
  }
  restaurarLista(det, 'P2:P1048576', 'Listas!$A$2:$A$9');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
