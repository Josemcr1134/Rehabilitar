/**
 * «Reporte Cabecera Facturación» de Medifolios → datos de contacto de cada paciente.
 *
 * El reporte de caja solo trae identificación y nombre. La cabecera de
 * facturación sí trae, por cada documento, DIR. TERCERO, TEL. TERCERO y
 * EMAIL TERCERO: con ella se completan los datos que exige la plantilla de
 * terceros de World Office para crear pacientes nuevos. No trae ciudad.
 *
 * Se pueden subir varios archivos (p. ej. enero–junio y julio–octubre): por
 * cada paciente se queda el dato más reciente que no esté vacío.
 *
 * Contiene datos personales: se procesa en el navegador y vive solo en memoria
 * (no se guarda en localStorage ni se envía a ningún servidor).
 */
import ExcelJS from 'exceljs';

export interface ContactoPaciente {
  identificacion: string;
  nombre: string;
  direccion: string;
  telefono: string;
  email: string;
  /** Fecha (AAAA-MM-DD) del documento del que salió cada dato, para quedarse con el más reciente. */
  fecha: string;
}

/** Datos de anulación de un documento, tal como los trae la cabecera (FECHA ANULACIÓN, CONCEPTO ANULACIÓN, QUIEN ANULA). */
export interface AnulacionCabecera {
  /** «R-15595», «COPG-8123»: SERIE + NUM. DOCUMENTO, igual que en el reporte de caja. */
  documento: string;
  fechaAnulacion: string;
  concepto: string;
  quienAnula: string;
}

export interface ArchivoCabecera {
  nombre: string;
  periodo: string;
  filas: number;
  pacientes: number;
}

/** Columnas que se buscan en la fila de encabezados del reporte (las demás se ignoran). */
export const COLUMNAS_CABECERA = {
  id: 'ID. TERCERO', nombre: 'NOM. TERCERO', direccion: 'DIR. TERCERO', telefono: 'TEL. TERCERO', email: 'EMAIL TERCERO', fecha: 'FECHA',
  serie: 'SERIE', numero: 'NUM. DOCUMENTO', fechaAnulacion: 'FECHA ANULACIÓN', conceptoAnulacion: 'CONCEPTO ANULACIÓN', quienAnula: 'QUIEN ANULA',
} as const;

function textoCelda(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o['richText'])) return (o['richText'] as Array<{ text: string }>).map((x) => x.text).join('');
    if ('text' in o) return String(o['text'] ?? '');
    if ('result' in o) return textoCelda(o['result'] as ExcelJS.CellValue);
    return '';
  }
  return String(v);
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Teléfono como lo pide la plantilla de World Office: solo dígitos, máximo 10.
 * Quita «+57» y cualquier símbolo; si hay varios números separados se queda con el primero válido.
 */
export function normalizarTelefono(t: string): string {
  for (const parte of String(t || '').split(/[,;/]|\s{2,}|\s-\s/)) {
    let d = parte.replace(/\D/g, '');
    if (d.length > 10 && d.startsWith('57')) d = d.slice(2);
    if (d.length >= 7 && d.length <= 10) return d;
  }
  return '';
}

const RE_EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Correo en minúsculas y sin espacios; vacío si no tiene forma de correo. */
export function normalizarEmail(e: string): string {
  const x = String(e || '').trim().toLowerCase().replace(/\s+/g, '');
  return RE_EMAIL.test(x) && x.length <= 60 ? x : '';
}

/** Dirección sin espacios repetidos (máx. 500 caracteres, como la plantilla). */
export const normalizarDireccion = (d: string) => String(d || '').replace(/\s+/g, ' ').trim().slice(0, 500);

/**
 * Lee un «Reporte Cabecera Facturación». Ubica sola la fila de encabezados
 * (en el reporte de Medifolios es la 3, debajo del título y del periodo).
 */
export async function leerCabeceraFacturacion(archivo: ArrayBuffer): Promise<{ contactos: ContactoPaciente[]; periodo: string; filas: number; anulaciones: AnulacionCabecera[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(archivo);
  for (const ws of wb.worksheets) {
    let filaEnc = 0;
    const col: Partial<Record<keyof typeof COLUMNAS_CABECERA, number>> = {};
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && !filaEnc; r++) {
      const vals = ws.getRow(r).values as ExcelJS.CellValue[];
      const idx = (nombre: string) => vals.findIndex((v) => norm(textoCelda(v)) === norm(nombre));
      if (idx(COLUMNAS_CABECERA.id) > 0 && idx(COLUMNAS_CABECERA.direccion) > 0) {
        filaEnc = r;
        (Object.keys(COLUMNAS_CABECERA) as Array<keyof typeof COLUMNAS_CABECERA>).forEach((k) => { const i = idx(COLUMNAS_CABECERA[k]); if (i > 0) col[k] = i; });
      }
    }
    if (!filaEnc) continue;
    let periodo = '';
    for (let r = 1; r < filaEnc; r++) {
      const m = textoCelda(ws.getRow(r).getCell(1).value).match(/PERIODO EVALUADO:\s*([^;]+)/i);
      if (m) periodo = m[1].trim();
    }
    const contactos: ContactoPaciente[] = [];
    const anulaciones: AnulacionCabecera[] = [];
    let filas = 0;
    for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const leer = (k: keyof typeof COLUMNAS_CABECERA) => (col[k] ? textoCelda(row.getCell(col[k]!).value).trim() : '');
      const fechaAnulacion = leer('fechaAnulacion');
      const serie = leer('serie').replace(/\s+/g, '').toUpperCase();
      const numero = leer('numero').replace(/\s+/g, '');
      if (fechaAnulacion && serie && numero) {
        anulaciones.push({ documento: `${serie}-${numero}`, fechaAnulacion, concepto: leer('conceptoAnulacion'), quienAnula: leer('quienAnula') });
      }
      const identificacion = leer('id').replace(/\s+/g, '');
      if (!identificacion) continue;
      filas++;
      contactos.push({
        identificacion, nombre: leer('nombre').replace(/\s+/g, ' '),
        direccion: normalizarDireccion(leer('direccion')), telefono: normalizarTelefono(leer('telefono')),
        email: normalizarEmail(leer('email')), fecha: leer('fecha').slice(0, 10),
      });
    }
    return { contactos, periodo, filas, anulaciones };
  }
  throw new Error('No parece un «Reporte Cabecera Facturación» de Medifolios: no se encontraron las columnas ID. TERCERO y DIR. TERCERO.');
}

/**
 * Une los contactos en un mapa por identificación. Por cada campo se queda con
 * el valor más reciente que no esté vacío (los archivos pueden cubrir periodos distintos).
 */
export function unirContactos(mapa: Map<string, ContactoPaciente>, contactos: ContactoPaciente[]): Map<string, ContactoPaciente> {
  const out = new Map(mapa);
  for (const c of contactos) {
    const prev = out.get(c.identificacion);
    if (!prev) { out.set(c.identificacion, { ...c }); continue; }
    const masNuevo = c.fecha >= prev.fecha;
    const elegir = (a: string, b: string) => (masNuevo ? (b || a) : (a || b));
    out.set(c.identificacion, {
      identificacion: c.identificacion,
      nombre: elegir(prev.nombre, c.nombre),
      direccion: elegir(prev.direccion, c.direccion),
      telefono: elegir(prev.telefono, c.telefono),
      email: elegir(prev.email, c.email),
      fecha: masNuevo ? c.fecha : prev.fecha,
    });
  }
  return out;
}
