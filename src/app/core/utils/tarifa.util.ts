/**
 * EXTRACCIÓN TARIFARIA (TAR / PAC / ENT) DESDE EL TEXTO DEL SERVICIO.
 * Migrado 1:1 desde index.html.
 *
 * La tarifa no vive en ninguna tabla aparte: viene escrita dentro del propio
 * texto del servicio (REFERENCIA en agenda, ITEMS en caja, DESCRIPCION en
 * consumo). Tres formatos conviven en los datos reales:
 *   1) "... TAR 31.500 PAC 20.300 ENT 11.200"  -> convenio con copago
 *   2) "... PART 32.000"                        -> particular: el paciente paga todo
 *   3) "... PACIENTE 25.000 ENTIDAD 0"           -> PROBIENESTAR y similares
 *
 * El \b inicial en los regex es imprescindible: sin él, "PROBIENESTAR 2026" hace
 * match con "TAR" y captura el AÑO como si fuera la tarifa.
 */
import { Tarifa } from '../models/records.model';
import { parseMoneda, up } from './normalizacion.util';

export function limpiarServicio(texto: unknown): string {
  return up(texto || '')
    .replace(/\s+/g, ' ')
    .replace(/^\(\s*\d+[^)]*\)\s*/, '') // prefijo "(1046733888 IAN VERGARA)"
    .replace(/[-.]\s*\d*\s*NUA\.?\s*.*$/, '') // cola "- 931001 NUA. 26717..."
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
}

const VACIO: Tarifa = { tar: null, pac: null, ent: null, copagoExplicito: false, detectado: false, tipo: '', regla: 'VACIO' };

export function extraerTarifa(texto: unknown): Tarifa {
  const bruto = up(texto || '');
  if (!bruto) return { ...VACIO };
  // Abonos y recaudos de cartera no describen un servicio: no traen tarifa.
  if (/^ABONO|ABONO\s+DOCUMENTO/.test(bruto)) {
    return { ...VACIO, tipo: 'PAGO DE DEUDA', regla: 'SIN TARIFA (ABONO)' };
  }
  const t = limpiarServicio(bruto);
  const g = (re: RegExp): number | null => {
    const m = t.match(re);
    return m ? parseMoneda(m[1]) : null;
  };
  const tar = g(/\bTAR\.?\s*[:-]?\s*([\d.,]+)/);
  const pac = g(/\bPAC\.?\s*[:-]?\s*([\d.,]+)/);
  const ent = g(/\bENT\.?\s*[:-]?\s*([\d.,]+)/);
  if (tar !== null || pac !== null || ent !== null) {
    return {
      tar: tar !== null ? tar : (pac || 0) + (ent || 0),
      pac: pac || 0,
      ent: ent || 0,
      copagoExplicito: pac !== null,
      detectado: true,
      tipo: 'CONVENIO',
      regla: tar !== null ? 'TAR/PAC/ENT' : 'PAC/ENT',
    };
  }
  const pa = g(/\bPACIENTE\.?\s*[:-]?\s*([\d.,]+)/);
  const en = g(/\bENTIDAD\.?\s*[:-]?\s*([\d.,]+)/);
  if (pa !== null || en !== null) {
    return { tar: (pa || 0) + (en || 0), pac: pa || 0, ent: en || 0, copagoExplicito: false, detectado: true, tipo: 'CONVENIO PARTICULAR', regla: 'PACIENTE/ENTIDAD' };
  }
  // Particular y PROBIENESTAR: el paciente asume todo (PAC = tarifa, ENT = 0).
  const part = g(/\bPART(?:ICULAR)?\.?\s*[:-]?\s*([\d.,]+)/);
  if (part !== null) {
    return { tar: part, pac: part, ent: 0, copagoExplicito: false, detectado: true, tipo: 'PARTICULAR', regla: 'PART' };
  }
  return { ...VACIO, regla: 'NO RECONOCIDO' };
}

/** Un mismo renglón de CAJA puede traer varios servicios separados por " | ". */
export function itemsDeCampo(texto: unknown): string[] {
  return String(texto == null ? '' : texto).split(/\s*\|\s*/).filter((x) => x.trim());
}

/** La tarifa UNITARIA solo tiene sentido si todos los ítems valen lo mismo; si no, se reportan los totales. */
export function tarifaDeCampo(texto: unknown): Tarifa {
  const ps = itemsDeCampo(texto);
  const nulo: Tarifa = { tar: null, pac: null, ent: null, detectado: false, tipo: '', regla: 'VACIO', copagoExplicito: false, n: 0, total: { tar: null, pac: null, ent: null } };
  if (!ps.length) return nulo;
  const parsed = ps.map(extraerTarifa);
  const con = parsed.filter((p) => p.detectado);
  const total = con.length
    ? { tar: con.reduce((s, p) => s + (p.tar || 0), 0), pac: con.reduce((s, p) => s + (p.pac || 0), 0), ent: con.reduce((s, p) => s + (p.ent || 0), 0) }
    : { tar: null, pac: null, ent: null };
  const claves = new Set(parsed.map((p) => p.tar + '|' + p.pac + '|' + p.ent));
  if (claves.size === 1) {
    const p = parsed[0];
    return { ...p, n: ps.length, total, regla: ps.length > 1 ? p.regla + ' (x' + ps.length + ' iguales)' : p.regla };
  }
  const tipos = [...new Set(parsed.map((p) => p.tipo).filter(Boolean))].sort();
  return { tar: null, pac: null, ent: null, detectado: false, copagoExplicito: false, tipo: tipos.join('/'), regla: 'VARIOS SERVICIOS EN EL RENGLON (' + ps.length + ')', n: ps.length, total };
}

export function servicioBase(texto: unknown): string {
  return up(texto || '')
    .replace(/\bTAR\.?\s*[:-]?\s*[\d.,]+.*$/, '')
    .replace(/\bPART\.?\s*[:-]?\s*[\d.,]+.*$/, '')
    .replace(/\bPACIENTE\.?\s*[:-]?\s*[\d.,]+.*$/, '')
    .trim();
}

/** 'SI' / 'NO' / 'N/A' cuando hay menos de dos fuentes con dato: sin dos valores no existe comparación. */
export function compararNumeros(arr: (number | null | undefined)[]): 'SI' | 'NO' | 'N/A' {
  const vals = arr.filter((v): v is number => v !== null && v !== undefined);
  if (vals.length < 2) return 'N/A';
  return new Set(vals.map((v) => Math.round(v))).size === 1 ? 'SI' : 'NO';
}

/**
 * Tarifa declarada por una fuente para un mismo servicio base. Si dentro de la
 * misma fuente conviven dos tarifas distintas para el mismo servicio, se marca
 * variasTarifas: eso ya es una inconsistencia por sí sola.
 */
export function tarifaDeFuente(tarifas: (Tarifa | null | undefined)[]): Tarifa {
  const dets = (tarifas || []).filter((t): t is Tarifa => !!t && t.detectado);
  if (!dets.length) {
    return { tar: null, pac: null, ent: null, copagoExplicito: false, detectado: false, tipo: '', regla: '', presente: (tarifas || []).length > 0, variasTarifas: false, fuente: '' };
  }
  const uniq = [...new Set(dets.map((t) => `${t.tar}|${t.pac}|${t.ent}`))];
  return {
    tar: dets[0].tar, pac: dets[0].pac, ent: dets[0].ent, copagoExplicito: dets[0].copagoExplicito,
    detectado: true, tipo: dets[0].tipo, regla: dets[0].regla, presente: true, variasTarifas: uniq.length > 1,
    brutoDifiere: dets.some((t) => t.brutoDifiere), fuente: dets[0].fuente || 'texto',
  };
}
