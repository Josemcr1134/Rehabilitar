/**
 * Motor de comparación cualitativa entre fuentes y motor de hipótesis de por
 * qué un dato no coincide. Migrado 1:1 desde index.html.
 */
import { AgendaRecord, CajaRecord, ConsumoRecord, TipoFuente } from '../models/records.model';
import { levenshtein, up } from './normalizacion.util';

type Fila = AgendaRecord | CajaRecord | ConsumoRecord;

export interface CampoComparable {
  label: string;
  get: Record<TipoFuente, (r: any) => string>;
}

export const CAMPOS_COMPARABLES: CampoComparable[] = [
  { label: 'Nombre', get: { AGENDA: (r) => r.nombre, CAJA: (r) => r.nombre, CONSUMO: (r) => r.nombre } },
  { label: 'EPS / Entidad', get: { AGENDA: (r) => r.eps, CAJA: (r) => r.entidad, CONSUMO: (r) => r.eps } },
  { label: 'N° Autorización', get: { AGENDA: (r) => r.autorizacion, CAJA: (r) => r.autorizacion, CONSUMO: (r) => r.autorizacion } },
  { label: 'Referencia / Servicio', get: { AGENDA: (r) => r.referencia, CAJA: (r) => r.items, CONSUMO: (r) => r.descripcion } },
  { label: 'Profesional', get: { AGENDA: (r) => r.profesional, CAJA: (r) => r.profesional, CONSUMO: (r) => r.profesional } },
];

export interface GrupoFuentes { agenda: Fila[]; caja: Fila[]; consumo: Fila[] }

export function valoresPorFuente(g: GrupoFuentes, campo: CampoComparable): Record<TipoFuente, string> {
  const out = {} as Record<TipoFuente, string>;
  (['AGENDA', 'CAJA', 'CONSUMO'] as TipoFuente[]).forEach((src) => {
    const arr = src === 'AGENDA' ? g.agenda : src === 'CAJA' ? g.caja : g.consumo;
    const vals = [...new Set(arr.map(campo.get[src]).map((v) => String(v || '').trim()).filter(Boolean))];
    out[src] = vals.join(' | ');
  });
  return out;
}

export interface ComparacionCampo {
  campo: string;
  valores: Record<TipoFuente, string>;
  coincide: boolean;
  hipotesis: string;
}

export function compararCampo(campo: CampoComparable, g: GrupoFuentes, fuentesPresentes: TipoFuente[]): ComparacionCampo {
  const valores = valoresPorFuente(g, campo);
  const presentes = fuentesPresentes.map((src) => ({ src, val: valores[src] }));
  const conValor = presentes.filter((p) => p.val);
  const sinValor = presentes.filter((p) => !p.val);
  if (conValor.length === 0) return { campo: campo.label, valores, coincide: true, hipotesis: '' };
  if (sinValor.length > 0 && fuentesPresentes.length > 1) {
    return { campo: campo.label, valores, coincide: false, hipotesis: `Dato ausente en ${sinValor.map((s) => s.src).join(' y ')} — posible dato incompleto o falta de sincronización entre sistemas` };
  }
  const distintos = [...new Set(conValor.map((p) => up(p.val)))];
  if (distintos.length <= 1) return { campo: campo.label, valores, coincide: true, hipotesis: '' };
  const a = conValor[0].val, b = (conValor[1] || { val: '' }).val;
  const an = up(a).replace(/\s+/g, ''), bn = up(b).replace(/\s+/g, '');
  let hip: string;
  if (an === bn) hip = 'Diferencia de formato: espacios en blanco o mayúsculas/minúsculas entre sistemas';
  else if (an.replace(/[^A-Z0-9]/g, '') === bn.replace(/[^A-Z0-9]/g, '')) hip = 'Caracteres especiales o de puntuación distintos entre sistemas';
  else if (an && bn && (an.startsWith(bn) || bn.startsWith(an))) hip = 'Posible truncamiento del dato en uno de los sistemas de origen';
  else {
    const dist = levenshtein(an, bn), maxLen = Math.max(an.length, bn.length, 1);
    hip = dist > 0 && (dist <= 2 || dist / maxLen < 0.25)
      ? 'Posible error de digitación (diferencia menor entre los valores capturados)'
      : 'Inconsistencia entre sistemas de origen: valores distintos sin un patrón de formato claro (posible error de origen o duplicidad)';
  }
  return { campo: campo.label, valores, coincide: false, hipotesis: hip };
}

export type EstadoConciliacion = '' | 'Conciliado' | 'Conteo diferente' | 'Solo agenda' | 'Solo caja' | 'Solo consumo' | 'Incompleto';

export function estadoConciliacion(ag: number, cj: number, co: number): EstadoConciliacion {
  const presentes = [ag > 0, cj > 0, co > 0].filter(Boolean).length;
  if (presentes === 0) return '';
  if (presentes === 3) return ag === cj && cj === co ? 'Conciliado' : 'Conteo diferente';
  if (presentes === 1) return ag > 0 ? 'Solo agenda' : cj > 0 ? 'Solo caja' : 'Solo consumo';
  return 'Incompleto';
}

/** Código de presencia por fuente: 'ACO' = las tres · 'A··' = solo agenda. */
export function fuentesCode(ag: number, cj: number, co: number): string {
  return (ag > 0 ? 'A' : '·') + (cj > 0 ? 'C' : '·') + (co > 0 ? 'O' : '·');
}

export interface GrupoConciliacion {
  id: string; fecha: string; nombre: string;
  agenda: AgendaRecord[]; caja: CajaRecord[]; consumo: ConsumoRecord[];
  countAgenda: number; countCaja: number; countConsumo: number;
  estado: EstadoConciliacion;
  comparaciones: ComparacionCampo[];
  observacion: string;
  accion: string;
}

export function construirObservacion(g: Pick<GrupoConciliacion, 'estado' | 'countAgenda' | 'countCaja' | 'countConsumo' | 'comparaciones'>): string {
  const partes: string[] = [];
  if (g.estado !== 'Conciliado' && g.estado !== 'Conteo diferente') {
    const faltan: string[] = [];
    if (g.countAgenda === 0) faltan.push('AGENDA');
    if (g.countCaja === 0) faltan.push('CAJA');
    if (g.countConsumo === 0) faltan.push('CONSUMO');
    if (faltan.length) partes.push(`Sin registro en: ${faltan.join(', ')}`);
  }
  if (g.estado === 'Conteo diferente') {
    partes.push(`Conteos distintos entre fuentes (AGENDA:${g.countAgenda}, CAJA:${g.countCaja}, CONSUMO:${g.countConsumo})`);
  }
  g.comparaciones.filter((c) => !c.coincide).forEach((c) => partes.push(`${c.campo} no coincide`));
  return partes.length ? partes.join(' · ') : 'Sin novedad';
}

export function construirAccion(g: Pick<GrupoConciliacion, 'estado' | 'comparaciones'>): string {
  if (g.estado === 'Conciliado' && !g.comparaciones.some((c) => !c.coincide)) return 'Ninguna';
  const texto = g.comparaciones.filter((c) => !c.coincide).map((c) => c.hipotesis).join(' ');
  if (/truncamiento/i.test(texto)) return 'Revisar la longitud máxima del campo en el sistema que truncó el dato.';
  if (/formato/i.test(texto)) return 'Estandarizar el formato de captura entre los sistemas involucrados.';
  if (/caracteres especiales/i.test(texto)) return 'Revisar tildes o caracteres especiales en la fuente de datos.';
  if (/digitación/i.test(texto)) return 'Verificar la digitación del dato contra el sistema de origen.';
  if (/ausente|sincroniz/i.test(texto)) return 'Verificar sincronización o captura del registro en el sistema donde falta el dato.';
  if (g.estado === 'Conteo diferente') return 'Revisar posible duplicidad o registros faltantes en la fuente con conteo distinto.';
  return 'Confirmar si el servicio no se atendió, no se facturó o no se consumió, o si falta cargarlo en el sistema faltante.';
}

export function primerValor(comp: ComparacionCampo | undefined): string {
  if (!comp) return '';
  return comp.valores.AGENDA || comp.valores.CAJA || comp.valores.CONSUMO || '';
}

export function okColumn(comp: ComparacionCampo | undefined): '' | 'SI' | 'NO' {
  if (!comp) return '';
  const vals = Object.values(comp.valores).map((v) => String(v || '').trim());
  if (!vals.some(Boolean)) return '';
  return comp.coincide ? 'SI' : 'NO';
}
