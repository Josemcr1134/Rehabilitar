import ExcelJS from 'exceljs';
import { FacturaWO, ReciboWO } from '../models/world-office.model';
import {
  candidatosTerceros, ciudadDesdeDireccion, completarCiudad, COLUMNAS_TERCEROS, dividirNombre, HOJA_TERCEROS, leerCiudades, llenarPlantillaTerceros, pareceEmpresa,
  TerceroNuevo, validarTercero,
} from './world-office-terceros.util';

/**
 * Plantilla en memoria con la MISMA estructura que la oficial de terceros
 * (fila 1 agrupadora, encabezados en la fila 2, filas de ejemplo y hoja oculta
 * LISTAS con las ciudades en la columna D). Datos sintéticos: el repositorio es público.
 */
// Como la oficial, «Tipo Tercero» trae un espacio duro (U+00A0) antes del asterisco.
const COLUMNAS_OFICIALES = COLUMNAS_TERCEROS.map((c) => (c === 'Tipo Tercero *' ? 'Tipo Tercero\u00a0*' : c));

async function plantillaSimulada(columnas = COLUMNAS_OFICIALES): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(HOJA_TERCEROS);
  ws.addRow(columnas.map((_, i) => (i < 22 ? 'Ficha Principal' : 'Ficha Dirección')));
  ws.addRow(columnas);
  ws.getCell('A2').note = 'World Office Cloud: ayuda del campo';
  ws.addRow(columnas.map(() => 'EJEMPLO'));
  ws.addRow(columnas.map(() => 'EJEMPLO'));
  const listas = wb.addWorksheet('LISTAS');
  listas.state = 'hidden';
  listas.addRow(['Tipo de Identificación*', 'Tipo Contribuyente *', 'Clasi.', 'Ciudad*']);
  listas.addRow(['Cédula de ciudadanía', 'Persona Natural Responsable del IVA', 'Exportador', 'Ciudad Uno']);
  listas.addRow(['NIT', 'Persona Jurídica', 'Normal', 'Ciudad Dos']);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const doc = (documento: string, cliente: string, nombre: string): FacturaWO =>
  ({ documento, cliente, nombre, tipo: 'FV' } as unknown as FacturaWO);

function completo(t: TerceroNuevo): TerceroNuevo {
  return { ...t, ciudad: 'Ciudad Uno', direccion: 'CL 1 2 3', telefono: '3001234567', email: 'paciente@correo.com' };
}

describe('Pacientes nuevos → plantilla oficial de terceros', () => {
  it('divide el nombre completo en nombres y apellidos', () => {
    expect(dividirNombre('ANA MARIA PEREZ GOMEZ')).toEqual({ primerNombre: 'ANA', segundoNombre: 'MARIA', primerApellido: 'PEREZ', segundoApellido: 'GOMEZ', aviso: null });
    expect(dividirNombre('JUAN CARLOS DE LA HOZ RUIZ')).toMatchObject({ primerNombre: 'JUAN', segundoNombre: 'CARLOS', primerApellido: 'DE LA HOZ', segundoApellido: 'RUIZ' });
    const tres = dividirNombre('LUIS PEREZ GOMEZ');
    expect(tres).toMatchObject({ primerNombre: 'LUIS', primerApellido: 'PEREZ', segundoApellido: 'GOMEZ' });
    expect(tres.aviso).toMatch(/3 palabras/);
    expect(dividirNombre('PEDRO ROJAS')).toMatchObject({ primerNombre: 'PEDRO', primerApellido: 'ROJAS', aviso: null });
  });

  it('reúne un registro por cliente con todos sus documentos y reconoce empresas', () => {
    const docs = [doc('R-1', '111', 'ANA MARIA PEREZ GOMEZ'), doc('COPG-2', '111', 'ANA MARIA PEREZ GOMEZ'),
      doc('R-3', '900123456', 'ASEGURADORA EJEMPLO SA'), { documento: 'ANTR-4', cliente: '222', nombre: 'LUIS PEREZ GOMEZ', tipo: 'RC' } as unknown as ReciboWO];
    const c = candidatosTerceros(docs);
    expect(c.map((t) => [t.identificacion, t.documentos])).toEqual([['111', ['R-1', 'COPG-2']], ['900123456', ['R-3']], ['222', ['ANTR-4']]]);
    expect(c[0]).toMatchObject({ tipoIdentificacion: 'Cédula de ciudadanía', esEmpresa: false, primerApellido: 'PEREZ' });
    expect(c[1]).toMatchObject({ tipoIdentificacion: 'NIT', esEmpresa: true, primerNombre: 'ASEGURADORA EJEMPLO SA', primerApellido: '' });
    expect(c[2].avisos.join(' ')).toMatch(/3 palabras/);
    expect(pareceEmpresa('12345', 'CLINICA EJEMPLO SAS')).toBe(true);
    expect(pareceEmpresa('12345', 'PEDRO ROJAS')).toBe(false);
  });

  it('valida los datos obligatorios de la plantilla (nada se inventa)', () => {
    const [t] = candidatosTerceros([doc('R-1', '111', 'ANA MARIA PEREZ GOMEZ')]);
    expect(validarTercero(t)).toEqual(['ciudad', 'dirección', 'teléfono', 'email']);
    expect(validarTercero(completo(t), ['Ciudad Uno'])).toEqual([]);
    expect(validarTercero({ ...completo(t), ciudad: 'Otra' }, ['Ciudad Uno']).join()).toMatch(/no está en la lista/);
    expect(validarTercero({ ...completo(t), telefono: '300-123' }).join()).toMatch(/teléfono/);
    expect(validarTercero({ ...completo(t), email: 'sin-arroba' }).join()).toMatch(/email/);
  });

  it('llena la plantilla oficial sin cambiar su estructura', async () => {
    const plantilla = await plantillaSimulada();
    expect(await leerCiudades(plantilla)).toEqual(['Ciudad Uno', 'Ciudad Dos']);
    const terceros = candidatosTerceros([doc('R-1', '111', 'ANA MARIA PEREZ GOMEZ'), doc('R-3', '900123456', 'ASEGURADORA EJEMPLO SA')]).map(completo);
    const buf = await llenarPlantillaTerceros(plantilla, terceros);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual([HOJA_TERCEROS, 'LISTAS']);
    expect(wb.getWorksheet('LISTAS')!.state).toBe('hidden');
    const ws = wb.getWorksheet(HOJA_TERCEROS)!;
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual(COLUMNAS_OFICIALES);
    expect(ws.getCell('A2').note).toBeTruthy();
    const fila = (r: number) => (ws.getRow(r).values as unknown[]).slice(1);
    expect(fila(3).slice(0, 8)).toEqual(['Cédula de ciudadanía', 111, 'Ciudad Uno', 'ANA', 'MARIA', 'PEREZ', 'GOMEZ', 'Cliente']);
    expect(fila(3).slice(11, 13)).toEqual(['Persona Natural No Responsable del IVA', 'Normal']);
    expect(fila(3).slice(22, 28)).toEqual(['Casa', 'Principal', 'CL 1 2 3', 3001234567, 'paciente@correo.com', 'Ciudad Uno']);
    expect(fila(4).slice(0, 4)).toEqual(['NIT', 900123456, 'Ciudad Uno', 'ASEGURADORA EJEMPLO SA']);
    expect(fila(4)[11]).toBe('Persona Jurídica');
    expect(fila(4)[22]).toBe('Empresa/Oficina');
    // Las filas de ejemplo de la plantilla ya no están.
    expect(fila(5).filter((v) => v !== null && v !== undefined)).toEqual([]);
  });

  it('se detiene con un mensaje claro si la plantilla cambió', async () => {
    const cambiada = await plantillaSimulada(['Tipo Identificación *', 'Otra columna', ...COLUMNAS_TERCEROS.slice(2)]);
    await expect(llenarPlantillaTerceros(cambiada, [])).rejects.toThrow(/La plantilla de terceros de World Office cambió/);
  });
});

describe('Ciudad automática desde la dirección', () => {
  const ciudades = ['Barranquilla', 'Soledad', 'Puerto Colombia', 'Colombia', 'Galapa', 'Bogotá, D.C.'];
  it('solo toma la ciudad si la dirección termina exactamente con un nombre de la lista de World Office', () => {
    expect(ciudadDesdeDireccion('CALLE 96 42D 13 BARRANQUILLA', ciudades)).toBe('Barranquilla');
    expect(ciudadDesdeDireccion('CRA 14-2 53-73  SOLEDAD', ciudades)).toBe('Soledad');
    expect(ciudadDesdeDireccion('CL 5 # 2-10 PUERTO COLOMBIA', ciudades)).toBe('Puerto Colombia');
    expect(ciudadDesdeDireccion('CALLE 11 12 101', ciudades)).toBe('');
    expect(ciudadDesdeDireccion('BARRIO SOLEDAD 2000 CASA 4', ciudades)).toBe('');
    expect(ciudadDesdeDireccion('BARRANQUILLA', ciudades)).toBe('');
  });
  it('no pisa una ciudad ya escogida y deja aviso para revisarla', () => {
    const base = { identificacion: '1', nombreCompleto: 'ANA', esEmpresa: false, tipoIdentificacion: 'Cédula de ciudadanía', primerNombre: 'ANA', segundoNombre: '',
      primerApellido: 'PEREZ', segundoApellido: '', ciudad: '', direccion: 'CALLE 1 2 3 GALAPA', telefono: '', email: '', documentos: [], avisos: [], enCabecera: true } as TerceroNuevo;
    const [a, b] = completarCiudad([base, { ...base, ciudad: 'Soledad' }], ciudades);
    expect(a.ciudad).toBe('Galapa');
    expect(a.avisos.join()).toContain('Ciudad tomada de la dirección');
    expect(b.ciudad).toBe('Soledad');
  });
});
