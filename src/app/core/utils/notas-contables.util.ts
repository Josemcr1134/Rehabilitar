/**
 * Arma las notas de contabilidad de World Office a partir de los reportes de Medifolios:
 *
 *   AGENDA (citas CUMPLIDAS) → causación de lo que asume cada parte:
 *     AP  / APL  = asume paciente  (Rehabilitar / Lilian)   Débito 13990501, Crédito 42559905/15/20/25
 *     AE  / AEL  = asume entidad   (Rehabilitar / Lilian)   Débito 13990502, Crédito 42509905/15/20/25
 *
 *   DIARIO DE CAJA (facturas pagadas por el paciente) → reversión de lo causado:
 *     APR / APLR = reversión asume paciente: Débito 4255990x, Crédito 13990501
 *
 * Reglas tomadas de las notas que ya se subieron a World Office (NC APL de junio–septiembre
 * y NC APR de mayo–septiembre) y de la hoja «CUENTAS» de las indicaciones de llenado:
 *   - Una nota por día. Una línea por cita (agenda) o por factura (caja).
 *   - Dentro de la nota van primero todas las líneas de la cuenta de servicio y luego,
 *     en el mismo orden, todas las de la cuenta puente 1399050x (así quedan en World Office).
 *   - Empresa: «CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S» en todas, como en la NC APL.
 *   - «Lilian» = todo lo de la «L»: en agenda, PUNTO ATENCION «LILIAN ARRAZOLA»; en caja,
 *     los prefijos con L (COPL, LA). El resto es Rehabilitar.
 *   - Solo citas CUMPLIDAS. Las cortesías (valor 0) no generan línea: World Office no acepta
 *     movimientos en cero; se informan aparte.
 *
 * Las reversiones de asume entidad (AER / AELR) todavía no tienen una regla confirmada
 * (no hay notas de ejemplo): se dejan fuera hasta que contabilidad diga de qué movimiento salen.
 */
import { AgendaRecord, CajaRecord } from '../models/records.model';
import { esMovimientoEntidad, prefijoDocumento } from './clasificacion.util';
import { centroDe, key, servicioDe } from './world-office.util';
import { LineaNota, NotaContable } from './world-office-notas.util';

export type PrefijoNota = 'AP' | 'APL' | 'AE' | 'AEL' | 'APR' | 'APLR' | 'AER' | 'AELR';
export type Servicio = 'FISIOTERAPIA' | 'TERAPIA OCUPACIONAL' | 'FONOAUDIOLOGIA' | 'PSICOLOGIA';

export const NOTAS_CONFIG = {
  empresa: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S',
  /** Tercero del encabezado de la nota (NIT de Rehabilitar, como en las notas ya cargadas). */
  terceroEncabezado: '900431402',
  cuentas: {
    paciente: { puente: '13990501', servicio: { FISIOTERAPIA: '42559905', 'TERAPIA OCUPACIONAL': '42559915', FONOAUDIOLOGIA: '42559920', PSICOLOGIA: '42559925' } },
    entidad: { puente: '13990502', servicio: { FISIOTERAPIA: '42509905', 'TERAPIA OCUPACIONAL': '42509915', FONOAUDIOLOGIA: '42509920', PSICOLOGIA: '42509925' } },
  } as Record<'paciente' | 'entidad', { puente: string; servicio: Record<Servicio, string> }>,
  conceptos: {
    AP: 'ASUME PACIENTE', APL: 'ASUME PACIENTE', AE: 'ASUME ENTIDAD', AEL: 'ASUME ENTIDAD',
    APR: 'REVERSIÓN ASUME PACIENTE', APLR: 'REVERSIÓN ASUME PACIENTE', AER: 'REVERSIÓN ASUME ENTIDAD', AELR: 'REVERSIÓN ASUME ENTIDAD',
  } as Record<PrefijoNota, string>,
  /** Último número cargado en World Office según las notas de ejemplo (la app sugiere el siguiente). */
  ultimosNumeros: { APL: 405, APR: 433 } as Partial<Record<PrefijoNota, number>>,
  descripcion: {
    AP: 'Asume paciente Rehabilitar', APL: 'Asume paciente Lilian', AE: 'Asume entidad Rehabilitar', AEL: 'Asume entidad Lilian',
    APR: 'Reversión asume paciente Rehabilitar', APLR: 'Reversión asume paciente Lilian',
    AER: 'Reversión asume entidad Rehabilitar', AELR: 'Reversión asume entidad Lilian',
  } as Record<PrefijoNota, string>,
};

export const PREFIJOS_AGENDA: PrefijoNota[] = ['AP', 'APL', 'AE', 'AEL'];
export const PREFIJOS_CAJA: PrefijoNota[] = ['APR', 'APLR'];

/** Una cita o factura que no generó línea, con el motivo (para mostrarla en pantalla). */
export interface OmitidaNota {
  fecha: string;
  documento: string;
  id: string;
  nombre: string;
  motivo: string;
}

export interface ResultadoNotas {
  notas: NotaContable[];
  omitidas: OmitidaNota[];
}

const limpio = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;

/**
 * Valores pactados que trae la REFERENCIA de la cita:
 *   «… TAR 38.900 PAC 19.000 ENT 19.900», «… PACIENTE 19.000 ENTIDAD 19.900»,
 *   «… PART 80.000» (particular: todo lo asume el paciente) o «CORTESIA» (0).
 */
export function valoresReferencia(referencia: string): { paciente: number; entidad: number; encontrado: boolean } {
  const r = key(referencia);
  const pac = r.match(/\bPAC(?:IENTE)?\s*\$?\s*([\d.,]+)/);
  const ent = r.match(/\bENT(?:IDAD)?\s*\$?\s*([\d.,]+)/);
  if (pac || ent) return { paciente: pac ? num(pac[1]) : 0, entidad: ent ? num(ent[1]) : 0, encontrado: true };
  const part = r.match(/\bPART(?:ICULAR)?\s*\$?\s*([\d.,]+)/);
  if (part) return { paciente: num(part[1]), entidad: 0, encontrado: true };
  if (/CORTESIA/.test(r)) return { paciente: 0, entidad: 0, encontrado: true };
  return { paciente: 0, entidad: 0, encontrado: false };
}

/**
 * Servicio de la cita o factura. Igual que servicioDe() de World Office, y además
 * NEURODINAMIA va a FISIOTERAPIA (así está en las notas APR ya cargadas);
 * NEUROPSICOLOGÍA (también escrita «NEUROSICOLOGICA») va a PSICOLOGIA.
 */
export function servicioNota(texto: string): Servicio | '' {
  const s = servicioDe(texto) as Servicio | '';
  if (s) return s;
  const t = key(texto);
  if (/NEURODINAMIA/.test(t)) return 'FISIOTERAPIA';
  if (/SICOLOG/.test(t)) return 'PSICOLOGIA'; // «NEUROSICOLOGICA» viene así escrito en Medifolios
  return '';
}

/** Cita de Lilian: PUNTO ATENCION «LILIAN ARRAZOLA» (o sin punto de atención pero con ella como profesional). */
export function esCitaLilian(a: Pick<AgendaRecord, 'sede' | 'profesional'>): boolean {
  const sede = key(a.sede);
  if (sede) return /LILIAN|ARRAZOLA/.test(sede);
  return /ARRAZOLA/.test(key(a.profesional));
}

/** Documento de caja de Lilian: prefijos con L (COPL, LA). */
export const esDocumentoLilian = (prefijo: string): boolean => prefijo === 'COPL' || prefijo === 'LA';

/** Prefijos de factura cuyo pago lo asume el paciente (reversión APR / APLR). */
const PREFIJOS_FACTURA = ['R', 'COPG', 'COPL', 'LA'];

/**
 * Formas de pago que NO son del paciente (pagos de entidad) o que no suman,
 * igual que el consolidado de caja: TRANSFERENCIAS FACTURACION, ANTICIPO COPAGO /
 * CUOTA MODERADORA, SIN VALOR y AJUSTE CARTERA.
 */
export function formaNoEsDelPaciente(forma: string): boolean {
  const f = key(forma);
  return /FACTURACION|COPAGO|CUOTA MODERADORA|SIN VALOR|AJUSTE/.test(f);
}

function armarNota(prefijo: PrefijoNota, numero: number, fecha: string, lineas: Pendiente[], servicioAlDebito: boolean): NotaContable {
  const servicio: LineaNota[] = lineas.map((l) => ({
    cuenta: l.cuentaServicio, concepto: l.concepto, tercero: l.tercero, nombre: l.nombre, centroCosto: l.centro,
    debito: servicioAlDebito ? l.valor : null, credito: servicioAlDebito ? null : l.valor,
  }));
  const puente: LineaNota[] = lineas.map((l) => ({
    cuenta: l.puente, concepto: l.concepto, tercero: l.tercero, nombre: l.nombre, centroCosto: l.centro,
    debito: servicioAlDebito ? null : l.valor, credito: servicioAlDebito ? l.valor : null,
  }));
  return {
    empresa: NOTAS_CONFIG.empresa, prefijo, numero, fecha, tercero: NOTAS_CONFIG.terceroEncabezado,
    concepto: NOTAS_CONFIG.conceptos[prefijo], verificado: 'NO', anulado: 'NO', lineas: [...servicio, ...puente],
  };
}

type Pendiente = { cuentaServicio: string; puente: string; concepto: string; tercero: string; nombre: string; valor: number; centro: string };

function numerar(porPrefijoYFecha: Map<PrefijoNota, Map<string, Pendiente[]>>, orden: PrefijoNota[], siguientes: Partial<Record<PrefijoNota, number>>, servicioAlDebito: boolean): NotaContable[] {
  const notas: NotaContable[] = [];
  for (const prefijo of orden) {
    const porFecha = porPrefijoYFecha.get(prefijo);
    if (!porFecha) continue;
    let n = siguientes[prefijo] ?? 1;
    for (const fecha of [...porFecha.keys()].sort()) notas.push(armarNota(prefijo, n++, fecha, porFecha.get(fecha)!, servicioAlDebito));
  }
  return notas;
}

function agregar(m: Map<PrefijoNota, Map<string, Pendiente[]>>, prefijo: PrefijoNota, fecha: string, l: Pendiente) {
  if (!m.has(prefijo)) m.set(prefijo, new Map());
  const pf = m.get(prefijo)!;
  if (!pf.has(fecha)) pf.set(fecha, []);
  pf.get(fecha)!.push(l);
}

/**
 * AGENDA → notas AP, APL, AE y AEL (una por día y prefijo, numeradas desde `siguientes`).
 * `incluir` limita qué prefijos se arman (p. ej. solo los de asume paciente).
 */
export function notasDesdeAgenda(agenda: AgendaRecord[], siguientes: Partial<Record<PrefijoNota, number>>, incluir: PrefijoNota[] = PREFIJOS_AGENDA): ResultadoNotas {
  const m = new Map<PrefijoNota, Map<string, Pendiente[]>>();
  const omitidas: OmitidaNota[] = [];
  for (const a of agenda) {
    if (key(a.estado) !== 'CUMPLIDA') continue;
    const base = { fecha: a.fecha, documento: limpio(a.referencia).slice(0, 80), id: a.id, nombre: limpio(a.nombre) };
    if (!a.fecha) { omitidas.push({ ...base, motivo: 'Cita sin fecha asignada' }); continue; }
    const v = valoresReferencia(a.referencia);
    if (!v.encontrado) { omitidas.push({ ...base, motivo: 'La referencia no trae los valores (PAC / ENT / PART)' }); continue; }
    if (v.paciente <= 0 && v.entidad <= 0) { omitidas.push({ ...base, motivo: 'Cortesía o valor 0: World Office no acepta líneas en cero' }); continue; }
    const servicio = servicioNota(a.referencia);
    if (!servicio) { omitidas.push({ ...base, motivo: 'No se reconoce el servicio (fisioterapia, T.O., fonoaudiología o psicología)' }); continue; }
    const lilian = esCitaLilian(a);
    const centro = centroDe(a.eps);
    for (const [parte, valor] of [['paciente', v.paciente], ['entidad', v.entidad]] as const) {
      if (valor <= 0) continue;
      const prefijo: PrefijoNota = parte === 'paciente' ? (lilian ? 'APL' : 'AP') : (lilian ? 'AEL' : 'AE');
      if (!incluir.includes(prefijo)) continue;
      const cuentas = NOTAS_CONFIG.cuentas[parte];
      agregar(m, prefijo, a.fecha, {
        cuentaServicio: cuentas.servicio[servicio], puente: cuentas.puente, tercero: a.id, nombre: limpio(a.nombre), valor, centro,
        concepto: `${limpio(a.nombre)} - ${servicio} - ${parte === 'paciente' ? 'ASUME PACIENTE' : 'ASUME ENTIDAD'}`,
      });
    }
  }
  return { notas: numerar(m, PREFIJOS_AGENDA, siguientes, false), omitidas };
}

/**
 * DIARIO DE CAJA → notas APR y APLR: una línea por factura (R, COPG, COPL, LA) facturada,
 * con la suma de lo que pagó el paciente (sin pagos de entidad, anticipos copago, sin valor ni ajustes).
 */
export function notasDesdeCaja(caja: CajaRecord[], siguientes: Partial<Record<PrefijoNota, number>>, incluir: PrefijoNota[] = PREFIJOS_CAJA): ResultadoNotas {
  const omitidas: OmitidaNota[] = [];
  const porDoc = new Map<string, { r: CajaRecord; prefijo: string; valor: number }>();
  for (const r of caja) {
    const prefijo = prefijoDocumento(r.documento);
    if (!PREFIJOS_FACTURA.includes(prefijo)) continue;
    if (key(r.estado).startsWith('A')) continue;
    if (esMovimientoEntidad(r) || formaNoEsDelPaciente(r.formaPago) || !(r.valor > 0)) continue;
    const doc = r.documento.replace(/\s+/g, '').toUpperCase();
    const prev = porDoc.get(doc);
    if (prev) prev.valor += r.valor;
    else porDoc.set(doc, { r, prefijo, valor: r.valor });
  }
  const m = new Map<PrefijoNota, Map<string, Pendiente[]>>();
  const cuentas = NOTAS_CONFIG.cuentas.paciente;
  for (const [doc, { r, prefijo, valor }] of porDoc) {
    const nombre = limpio(r.nombre);
    const servicio = servicioNota(r.itemsRaw || r.items);
    if (!servicio) { omitidas.push({ fecha: r.fecha, documento: doc, id: r.id, nombre, motivo: 'No se reconoce el servicio en ITEMS' }); continue; }
    if (!r.fecha) { omitidas.push({ fecha: '', documento: doc, id: r.id, nombre, motivo: 'Documento sin fecha' }); continue; }
    const nota: PrefijoNota = esDocumentoLilian(prefijo) ? 'APLR' : 'APR';
    if (!incluir.includes(nota)) continue;
    const numero = doc.slice(prefijo.length).replace(/^-/, '');
    agregar(m, nota, r.fecha, {
      cuentaServicio: cuentas.servicio[servicio], puente: cuentas.puente, tercero: r.id, nombre, valor, centro: centroDe(r.entidad),
      concepto: `FV ${prefijo} ${numero} - ${nombre} - ${servicio}`,
    });
  }
  return { notas: numerar(m, PREFIJOS_CAJA, siguientes, true), omitidas };
}

/** Siguiente número sugerido para cada prefijo (el último conocido + 1, o 1). */
export function siguientesPorDefecto(): Record<PrefijoNota, number> {
  const out = {} as Record<PrefijoNota, number>;
  for (const p of Object.keys(NOTAS_CONFIG.conceptos) as PrefijoNota[]) out[p] = (NOTAS_CONFIG.ultimosNumeros[p] ?? 0) + 1;
  return out;
}
