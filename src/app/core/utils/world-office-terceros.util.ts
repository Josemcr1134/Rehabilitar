/**
 * Pacientes nuevos → PLANTILLA OFICIAL DE TERCEROS de World Office
 * (public/plantillas-wo/PlantillaTerceros.xlsx, hoja «Importación Terceros»).
 *
 * Antes de enviar facturas o recibos, cada cliente (ID. TERCERO del reporte de
 * caja) debe existir como tercero en World Office. Los que no existen se
 * reúnen aquí y se escriben en la plantilla oficial para importarlos.
 *
 * El reporte de caja de Medifolios solo trae la identificación y el nombre
 * completo. La plantilla además exige tipo de identificación, ciudad,
 * dirección, teléfono y correo: esos datos se completan en pantalla antes de
 * descargar (validarTercero dice qué falta). Nada se inventa.
 *
 * Igual que las otras plantillas: se abre el archivo oficial, se verifican los
 * encabezados (fila 2), se borran solo las filas de ejemplo y se restauran las
 * listas desplegables. No se agregan, quitan ni renombran columnas.
 */
import ExcelJS from 'exceljs';
import { FacturaWO, ReciboWO, WO_CONFIG } from '../models/world-office.model';
import { ContactoPaciente } from './cabecera-facturacion.util';
import { conservarFirmaPlantilla } from './plantilla-firma.util';

export const RUTA_PLANTILLA_TERCEROS = 'plantillas-wo/PlantillaTerceros.xlsx';
export const HOJA_TERCEROS = 'Importación Terceros';

/** Encabezados exactos de la fila 2 de la plantilla oficial (la fila 1 agrupa «Ficha Principal» / «Ficha Dirección»). */
export const COLUMNAS_TERCEROS: string[] = [
  'Tipo Identificación *', 'Identificación *', 'Ciudad Identificación*', 'Primer Nombre ó Razon Social*', 'Segundo Nombre',
  'Primer Apellido *', 'Segundo Apellido', 'Tipo Tercero *', 'Código', 'Activo', 'Actividad Económica', 'Tipo Contribuyente *',
  'Clasi. Administrador Impuesto *', 'Excepción Impuesto', 'Tarifa Reteica Compras', 'Aplica Reteica Ventas', 'Maneja Cupo Crédito',
  'Vendedor', 'Lista Precios', 'Forma Pago', 'Plazo Días', 'Porcentaje Descuento', 'Tipo Dirección *', 'Nombre Dirección *',
  'Dirección *', 'Teléfonos *', 'Email *', 'Ciudad Dirección *', 'Zona', 'Barrio',
];

/** Valores válidos de «Tipo Identificación *» (hoja oculta LISTAS de la plantilla). */
export const TIPOS_IDENTIFICACION = [
  'Cédula de ciudadanía', 'Cédula de Extranjería', 'Documento de Identificación Extranjero', 'NIT', 'Pasaporte',
  'Permiso Especial de Permanencia', 'Registro Civil', 'Sin ID del exterior o para uso definido por DIAN',
  'Tarjeta de Extranjería', 'Tarjeta de Identidad',
];

export interface TerceroNuevo {
  identificacion: string;
  nombreCompleto: string;
  tipoIdentificacion: string;
  esEmpresa: boolean;
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  ciudad: string;
  direccion: string;
  telefono: string;
  email: string;
  /** Documentos de caja de este paciente que no se pueden enviar hasta crearlo. */
  documentos: string[];
  /** Advertencias que no impiden descargar (p. ej. nombre de 3 palabras). */
  avisos: string[];
  /** ¿Se encontró en la cabecera de facturación cargada? null = no se ha cargado ninguna. */
  enCabecera: boolean | null;
}

const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'DA', 'DI', 'VAN', 'VON', 'Y']);
const RE_EMPRESA = /\b(S\.?A\.?S?|LTDA|E\.?P\.?S|I\.?P\.?S|E\.?S\.?E|SEGUROS?|COMPA[NÑ]IA|CORPORACI[OÓ]N|FUNDACI[OÓ]N|ASOCIACI[OÓ]N|COOPERATIVA|MEDICINA PREPAGADA|ALCALD[IÍ]A|GOBERNACI[OÓ]N|EMPRESA|SOCIEDAD)\b/;

/** ¿El tercero es una empresa (NIT) y no una persona? Por el nombre o por un NIT de 9 dígitos que empieza en 8 o 9. */
export function pareceEmpresa(identificacion: string, nombre: string): boolean {
  return RE_EMPRESA.test(String(nombre || '').toUpperCase()) || /^[89]\d{8}$/.test(String(identificacion || ''));
}

/** Agrupa partículas («DE LA HOZ» queda como un solo apellido). */
function bloquesNombre(nombre: string): string[] {
  const t = String(nombre || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const out: string[] = [];
  let pend: string[] = [];
  for (const p of t) {
    if (PARTICULAS.has(p.toUpperCase())) { pend.push(p); continue; }
    out.push([...pend, p].join(' '));
    pend = [];
  }
  if (pend.length) {
    if (out.length) out[out.length - 1] += ' ' + pend.join(' ');
    else out.push(pend.join(' '));
  }
  return out;
}

/**
 * Divide el nombre completo de Medifolios («NOMBRE1 NOMBRE2 APELLIDO1 APELLIDO2»)
 * en los cuatro campos de la plantilla. Con 3 palabras no se puede saber si son
 * 2 nombres + 1 apellido o 1 nombre + 2 apellidos: se asume lo segundo y se avisa.
 */
export function dividirNombre(nombre: string): { primerNombre: string; segundoNombre: string; primerApellido: string; segundoApellido: string; aviso: string | null } {
  const b = bloquesNombre(nombre);
  const r = { primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '', aviso: null as string | null };
  if (b.length >= 4) {
    r.primerNombre = b[0]; r.segundoNombre = b.slice(1, b.length - 2).join(' ');
    r.primerApellido = b[b.length - 2]; r.segundoApellido = b[b.length - 1];
  } else if (b.length === 3) {
    r.primerNombre = b[0]; r.primerApellido = b[1]; r.segundoApellido = b[2];
    r.aviso = 'Nombre de 3 palabras: revisa si es 1 nombre + 2 apellidos (así quedó) o 2 nombres + 1 apellido';
  } else if (b.length === 2) {
    r.primerNombre = b[0]; r.primerApellido = b[1];
  } else if (b.length === 1) {
    r.primerNombre = b[0];
    r.aviso = 'El nombre tiene una sola palabra: falta el apellido';
  }
  return r;
}

/** Un registro por cliente (ID. TERCERO) de los documentos a enviar, con la lista de sus documentos. */
/** Lo mínimo que necesita la revisión de pacientes: identificación, nombre y documento (factura, recibo o nota contable). */
export type DocumentoConTercero = Pick<FacturaWO | ReciboWO, 'cliente' | 'nombre' | 'documento'>;

export function candidatosTerceros(docs: DocumentoConTercero[]): TerceroNuevo[] {
  const porId = new Map<string, TerceroNuevo>();
  for (const d of docs) {
    const id = String(d.cliente || '').trim();
    if (!id) continue;
    const prev = porId.get(id);
    if (prev) { if (!prev.documentos.includes(d.documento)) prev.documentos.push(d.documento); continue; }
    const esEmpresa = pareceEmpresa(id, d.nombre);
    const t: TerceroNuevo = {
      identificacion: id, nombreCompleto: String(d.nombre || '').trim(), esEmpresa,
      tipoIdentificacion: esEmpresa ? 'NIT' : WO_CONFIG.terceros.tipoIdentificacionPersona,
      primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '',
      ciudad: WO_CONFIG.terceros.ciudadPorDefecto, direccion: '', telefono: '', email: '',
      documentos: [d.documento], avisos: [], enCabecera: null,
    };
    if (esEmpresa) {
      t.primerNombre = t.nombreCompleto;
    } else {
      const n = dividirNombre(t.nombreCompleto);
      Object.assign(t, { primerNombre: n.primerNombre, segundoNombre: n.segundoNombre, primerApellido: n.primerApellido, segundoApellido: n.segundoApellido });
      if (n.aviso) t.avisos.push(n.aviso);
    }
    porId.set(id, t);
  }
  return [...porId.values()];
}

/**
 * Completa dirección, teléfono y correo con la cabecera de facturación de Medifolios.
 * Solo llena lo que está vacío: nunca reemplaza lo que ya se escribió en pantalla.
 */
export function completarConCabecera(terceros: TerceroNuevo[], contactos: Map<string, ContactoPaciente>): TerceroNuevo[] {
  return terceros.map((t) => {
    const c = contactos.get(t.identificacion);
    if (!c) return { ...t, enCabecera: false };
    return {
      ...t, enCabecera: true,
      direccion: t.direccion || c.direccion,
      telefono: t.telefono || c.telefono,
      email: t.email || c.email,
    };
  });
}

const sinTildes = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9Ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Ciudad escrita al final de la dirección del paciente («CALLE 96 42D 13 BARRANQUILLA»).
 * Solo se acepta si las últimas palabras son EXACTAMENTE el nombre de una ciudad de la lista
 * oficial de World Office (hoja LISTAS de la plantilla de terceros); si coinciden varias, gana
 * el nombre más largo («PUERTO COLOMBIA» antes que «COLOMBIA»). Si no hay coincidencia exacta
 * devuelve '' y la ciudad se deja para escoger a mano: no se adivina.
 */
export function ciudadDesdeDireccion(direccion: string, ciudades: string[]): string {
  const dir = sinTildes(direccion || '');
  if (!dir || !ciudades.length) return '';
  let mejor = '';
  for (const c of ciudades) {
    const n = sinTildes(c);
    if (!n) continue;
    if ((dir === n || dir.endsWith(' ' + n)) && n.length > sinTildes(mejor).length) mejor = c;
  }
  // La dirección no puede ser solo el nombre de la ciudad (no sería una dirección).
  return mejor && sinTildes(mejor) !== dir ? mejor : '';
}

/** Llena la ciudad vacía de los pacientes nuevos cuando la dirección la trae escrita; no toca las ya escogidas. */
export function completarCiudad(terceros: TerceroNuevo[], ciudades: string[]): TerceroNuevo[] {
  return terceros.map((t) => {
    if (t.ciudad.trim() || !t.direccion.trim()) return t;
    const c = ciudadDesdeDireccion(t.direccion, ciudades);
    if (!c) return t;
    return { ...t, ciudad: c, avisos: [...t.avisos.filter((a) => !a.startsWith('Ciudad tomada')), `Ciudad tomada de la dirección (${c}): revísala`] };
  });
}

const RE_EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * Lo que le falta (o está mal) para que World Office acepte la fila, según las
 * reglas escritas en los comentarios de la plantilla oficial. Lista vacía = lista para importar.
 */
export function validarTercero(t: TerceroNuevo, ciudades?: string[]): string[] {
  const e: string[] = [];
  if (!TIPOS_IDENTIFICACION.includes(t.tipoIdentificacion)) e.push('tipo de identificación');
  if (!/^[A-Za-z0-9-]{1,20}$/.test(t.identificacion)) e.push('identificación (máx. 20, sin espacios)');
  if (!t.primerNombre.trim()) e.push(t.esEmpresa ? 'razón social' : 'primer nombre');
  if (!t.esEmpresa && !t.primerApellido.trim()) e.push('primer apellido');
  for (const [campo, v] of [['primer nombre', t.primerNombre], ['segundo nombre', t.segundoNombre], ['primer apellido', t.primerApellido], ['segundo apellido', t.segundoApellido]] as const) {
    if (v.length > 50) e.push(`${campo} (máx. 50 caracteres)`);
  }
  if (!t.ciudad.trim()) e.push('ciudad');
  else if (ciudades && ciudades.length && !ciudades.includes(t.ciudad.trim())) e.push(`ciudad «${t.ciudad}» no está en la lista de World Office`);
  if (!t.direccion.trim()) e.push('dirección');
  const tels = t.telefono.split(',').map((x) => x.trim()).filter(Boolean);
  if (!tels.length) e.push('teléfono');
  else if (tels.some((x) => !/^\d{1,10}$/.test(x))) e.push('teléfono (solo números, máx. 10 dígitos)');
  const mails = t.email.split(',').map((x) => x.trim()).filter(Boolean);
  if (!mails.length) e.push('email');
  else if (mails.some((x) => x.length > 60 || !RE_EMAIL.test(x))) e.push('email (formato nombre@dominio.com)');
  return e;
}

const texto = (v: ExcelJS.CellValue): string => (v == null ? '' : typeof v === 'object' && 'richText' in v ? v.richText.map((x) => x.text).join('') : String(v));

/** Ciudades válidas de World Office (hoja oculta LISTAS, columna D de la plantilla oficial). */
export async function leerCiudades(plantilla: ArrayBuffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(plantilla);
  const ws = wb.getWorksheet('LISTAS');
  const out: string[] = [];
  if (!ws) return out;
  for (let r = 2; r <= ws.rowCount; r++) { const v = texto(ws.getRow(r).getCell(4).value).trim(); if (v) out.push(v); }
  return out;
}

/** Número si son solo dígitos (como en los ejemplos de la plantilla); si no, texto. */
const numeroOTexto = (s: string): string | number => (/^\d{1,15}$/.test(s) ? Number(s) : s);

/**
 * ExcelJS no conserva las listas desplegables «x14» de la plantilla oficial
 * (apuntan a la hoja oculta LISTAS): se recrean con los mismos rangos.
 */
const LISTAS_TERCEROS: Array<[string, string]> = [
  ['A3:A7001', 'LISTAS!$A$2:$A$11'], ['C3:C7001', 'LISTAS!$D$2:$D$1036'], ['J3:J7001', 'LISTAS!$G$2:$G$3'],
  ['K3:K7001', 'LISTAS!$F$2:$F$502'], ['L3:L7001', 'LISTAS!$B$2:$B$16'], ['M3:M7001', 'LISTAS!$C$2:$C$9'],
  ['N3:N7001', 'LISTAS!$H$2:$H$4'], ['P3:P7001', 'LISTAS!$G$2:$G$3'], ['Q3:Q7001', 'LISTAS!$G$2:$G$3'],
  ['W3:W7001', 'LISTAS!$E$2:$E$5'], ['AB3:AB7001', 'LISTAS!$D$2:$D$1036'],
];

/** Llena PlantillaTerceros.xlsx con los pacientes nuevos (deben venir ya validados). */
export async function llenarPlantillaTerceros(plantilla: ArrayBuffer, terceros: TerceroNuevo[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(plantilla);
  const ws = wb.getWorksheet(HOJA_TERCEROS);
  if (!ws) throw new Error(`La plantilla de terceros de World Office no tiene la hoja «${HOJA_TERCEROS}».`);
  // La plantilla oficial trae espacios «duros» (U+00A0) en algunos encabezados: se comparan normalizados.
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
  COLUMNAS_TERCEROS.forEach((col, i) => {
    const real = texto(ws.getRow(2).getCell(i + 1).value);
    if (norm(real) !== norm(col)) {
      throw new Error(`La plantilla de terceros de World Office cambió: columna ${i + 1} es «${real}» y se esperaba «${col}».`);
    }
  });
  // Filas de ejemplo: se borran solo los valores (la hoja trae formato hasta la fila 7001).
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    for (let c = 1; c <= COLUMNAS_TERCEROS.length; c++) row.getCell(c).value = null;
  }
  const cfg = WO_CONFIG.terceros;
  terceros.forEach((t, i) => {
    const row = ws.getRow(3 + i);
    const tel = t.telefono.split(',').map((x) => x.trim()).filter(Boolean).join(',');
    const vals: Array<string | number | null> = [
      t.tipoIdentificacion, numeroOTexto(t.identificacion), t.ciudad.trim(), t.primerNombre.trim(), t.segundoNombre.trim() || null,
      t.esEmpresa ? (t.primerApellido.trim() || null) : t.primerApellido.trim(), t.segundoApellido.trim() || null,
      cfg.tipoTercero, null, 'Si', null, t.esEmpresa ? cfg.tipoContribuyenteEmpresa : cfg.tipoContribuyentePersona,
      cfg.clasificacionImpuesto, null, null, null, null, null, null, null, null, null,
      t.esEmpresa ? 'Empresa/Oficina' : cfg.tipoDireccion, cfg.nombreDireccion, t.direccion.trim(),
      tel.includes(',') ? tel : numeroOTexto(tel), t.email.split(',').map((x) => x.trim()).filter(Boolean).join(','), t.ciudad.trim(), null, null,
    ];
    vals.forEach((v, c) => { row.getCell(c + 1).value = v; });
    row.commit();
  });
  const dv = (ws as unknown as { dataValidations: { add(r: string, v: ExcelJS.DataValidation): void } }).dataValidations;
  for (const [rango, formula] of LISTAS_TERCEROS) dv.add(rango, { type: 'list', allowBlank: true, showErrorMessage: true, formulae: [formula] });
  return conservarFirmaPlantilla(plantilla, (await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
