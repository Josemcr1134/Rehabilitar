import ExcelJS from 'exceljs';
import { leerCabeceraFacturacion, normalizarEmail, normalizarTelefono, unirContactos } from './cabecera-facturacion.util';
import { candidatosTerceros, completarConCabecera, validarTercero } from './world-office-terceros.util';
import { FacturaWO } from '../models/world-office.model';

const ENCABEZADOS = ['DOCUMENTO', 'SERIE', 'SEDE', 'PROFESIONAL', 'NUM. DOCUMENTO', 'FECHA', 'ESTADO', 'EPS', 'ID. TERCERO', 'NOM. TERCERO',
  'DIR. TERCERO', 'TEL. TERCERO', 'EMAIL TERCERO', 'VLR. BRUTO'];

/** Reporte con la misma forma que el de Medifolios: título, periodo y encabezados en la fila 3. Datos sintéticos. */
async function cabeceraSimulada(filas: unknown[][], periodo = '2026-01-01 A 2026-06-30'): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reporte Cabecera Facturación');
  ws.addRow(ENCABEZADOS.map(() => 'REPORTE CABECERA FACTURACION'));
  ws.addRow(ENCABEZADOS.map(() => `FECHA GENERACIÓN: 2026-10-19 12:20:57; PERIODO EVALUADO:${periodo};FORMATO: EXCEL;`));
  ws.addRow(ENCABEZADOS);
  filas.forEach((f) => ws.addRow(f));
  wb.addWorksheet('Worksheet 1');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const fila = (fecha: string, id: number, nombre: string, dir: string, tel: unknown, email: unknown) =>
  ['FACTURA', 'R', 'PRINCIPAL', 'PROF', 1, fecha, 'F', 'PARTICULAR', id, nombre, dir, tel, email, 1000];

describe('Cabecera de facturación → datos de contacto de los pacientes', () => {
  it('normaliza teléfono y correo como los pide World Office', () => {
    expect(normalizarTelefono('+573001234567')).toBe('3001234567');
    expect(normalizarTelefono('300 123 4567')).toBe('3001234567');
    expect(normalizarTelefono('123')).toBe('');
    expect(normalizarEmail(' Paciente@Correo.COM ')).toBe('paciente@correo.com');
    expect(normalizarEmail('sin-arroba')).toBe('');
  });

  it('lee el reporte, ubica los encabezados y toma el periodo', async () => {
    const buf = await cabeceraSimulada([
      fila('2026-01-02', 111, 'ANA MARIA PEREZ GOMEZ', 'CALLE  1  2 3', 3001234567, { text: 'ana@correo.com', hyperlink: 'mailto:ana@correo.com' }),
      fila('2026-01-03', 222, 'LUIS ALBERTO ROJAS DIAZ', 'CRA 4 5 6', '+573107654321', 'luis@correo.com'),
    ]);
    const { contactos, periodo, filas } = await leerCabeceraFacturacion(buf);
    expect(periodo).toBe('2026-01-01 A 2026-06-30');
    expect(filas).toBe(2);
    expect(contactos[0]).toEqual({ identificacion: '111', nombre: 'ANA MARIA PEREZ GOMEZ', direccion: 'CALLE 1 2 3', telefono: '3001234567', email: 'ana@correo.com', fecha: '2026-01-02' });
    expect(contactos[1].telefono).toBe('3107654321');
  });

  it('con varios periodos se queda con el dato más reciente que no esté vacío', async () => {
    const ene = (await leerCabeceraFacturacion(await cabeceraSimulada([fila('2026-01-02', 111, 'ANA', 'DIR VIEJA', 3001111111, 'vieja@correo.com')]))).contactos;
    const jul = (await leerCabeceraFacturacion(await cabeceraSimulada([fila('2026-07-10', 111, 'ANA', 'DIR NUEVA', null, 'nueva@correo.com')], '2026-07-01 A 2026-10-19'))).contactos;
    const m = unirContactos(unirContactos(new Map(), jul), ene);
    expect(m.get('111')).toMatchObject({ direccion: 'DIR NUEVA', telefono: '3001111111', email: 'nueva@correo.com', fecha: '2026-07-10' });
  });

  it('completa a los pacientes nuevos sin pisar lo escrito en pantalla', async () => {
    const { contactos } = await leerCabeceraFacturacion(await cabeceraSimulada([fila('2026-01-02', 111, 'ANA MARIA PEREZ GOMEZ', 'CALLE 1 2 3', 3001234567, 'ana@correo.com')]));
    const docs = [{ documento: 'R-1', cliente: '111', nombre: 'ANA MARIA PEREZ GOMEZ' }, { documento: 'R-2', cliente: '999', nombre: 'PEDRO ROJAS' }] as unknown as FacturaWO[];
    const [ana, pedro] = candidatosTerceros(docs);
    ana.email = 'escrito@correo.com';
    const [a, p] = completarConCabecera([ana, pedro], unirContactos(new Map(), contactos));
    expect(a).toMatchObject({ enCabecera: true, direccion: 'CALLE 1 2 3', telefono: '3001234567', email: 'escrito@correo.com' });
    expect(p).toMatchObject({ enCabecera: false, direccion: '' });
    // Con la cabecera solo le falta la ciudad.
    expect(validarTercero(a)).toEqual(['ciudad']);
  });

  it('avisa si el archivo no es una cabecera de facturación', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('X').addRow(['OTRA', 'COSA']);
    await expect(leerCabeceraFacturacion((await wb.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toThrow(/Cabecera Facturación/);
  });
});

describe('Cabecera de facturación → anulaciones', () => {
  it('toma fecha, motivo y quién anuló por documento (SERIE-NUM. DOCUMENTO)', async () => {
    const H = [...ENCABEZADOS, 'FECHA ANULACIÓN', 'CONCEPTO ANULACIÓN', 'QUIEN ANULA'];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte');
    ws.addRow(['REPORTE CABECERA FACTURACION']); ws.addRow(['PERIODO EVALUADO:2026-07-01 A 2026-07-31;']); ws.addRow(H);
    ws.addRow(['FACTURA', 'COPG', 'P', 'X', 8123, '2026-07-01', 'A', 'COOMEVA', 111, 'ANA', 'CL 1', '', '', 20300, '2026-07-02 15:10:07', 'FORMA DE PAGO ERRADA', 'USUARIO CAJA']);
    ws.addRow(['FACTURA', 'R', 'P', 'X', 16000, '2026-07-01', 'F', 'PARTICULAR', 222, 'LUIS', 'CL 2', '', '', 30000, '', '', '']);
    const { anulaciones } = await leerCabeceraFacturacion((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(anulaciones).toEqual([{ documento: 'COPG-8123', fechaAnulacion: '2026-07-02 15:10:07', concepto: 'FORMA DE PAGO ERRADA', quienAnula: 'USUARIO CAJA' }]);
  });
});
