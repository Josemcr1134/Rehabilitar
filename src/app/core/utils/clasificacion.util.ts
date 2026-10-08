/**
 * Clasificación de movimientos de CAJA. Migrado 1:1 desde index.html.
 * Dos niveles, en este orden de aparición en el archivo original:
 *   1) classifyCaja()       — categoría gruesa, se calcula al normalizar el registro.
 *   2) clasificarMovimiento() — la matriz fina (prefijo × forma de pago), se calcula
 *                               bajo demanda (hoja analisis_caja / card 8).
 */
import { CajaRecord, CategoriaCaja } from '../models/records.model';
import {
  ClasificacionMovimiento, FORMAS_CON_RECAUDO, FP, GrupoMatriz, PREFIJOS_CONOCIDOS, REGLAS_DOC, RE_EMPRESA,
} from '../models/clasificacion.model';
import { up } from './normalizacion.util';

export function esNit(id: string): boolean {
  return id.length === 9 && (id[0] === '8' || id[0] === '9');
}

/**
 * El reporte de caja mezcla dos cosas distintas: los pagos de los pacientes por
 * servicios prestados y los abonos que las aseguradoras giran contra su cartera
 * ("ABONO DOCUMENTO R-15485", tercero con NIT). Estos últimos no son recaudo
 * del día ni corresponden a ningún servicio, así que no pueden entrar al cruce.
 */
export function esMovimientoEntidad(rec: { id: string; items: string }): boolean {
  return esNit(rec.id) || /^ABONO DOCUMENTO/.test(up(rec.items));
}

export function classifyCaja(rec: { formaPago: string; estado: string; id: string; items: string }): CategoriaCaja {
  const forma = up(rec.formaPago);
  const estado = up(rec.estado);
  if (estado === 'A') return 'ANULADO';
  if (esMovimientoEntidad(rec)) return forma.includes('ANTICIPO') ? 'ANTICIPO_EMPRESA' : 'TRANSF_FACTURACION';
  if (forma.includes('ANTICIPO')) return 'ANTICIPO';
  if (forma.includes('AJUSTE')) return 'AJUSTE';
  if (forma.includes('CREDITO') || forma.includes('CRÉDITO') || forma.includes('DEUDA')) return 'CREDITO';
  if (forma.includes('SIN VALOR')) return 'SIN_VALOR';
  return 'PAGO_NORMAL';
}

/**
 * El archivo escribe la misma forma de pago de varias maneras («TARGETA»,
 * «TRANSF. BANCOLOMBIA LILIAN», «CREDITO-DEUDA»...). Se normaliza a la matriz.
 * El orden de las pruebas importa: TARJETA se evalúa antes que CREDITO para que
 * «TARJETA DE CREDITO» no termine clasificada como cartera.
 */
export function normalizarFormaPago(txt: string): string {
  const f = up(txt).replace(/\s+/g, ' ').trim();
  if (!f) return '';
  if (/AJUSTE/.test(f)) return FP.AJUSTE;
  if (/SIN\s*VALOR/.test(f)) return FP.SIN_VALOR;
  if (/ANTICIPO/.test(f)) return /DESCUENTO/.test(f) ? FP.ANT_DESC : FP.ANT_COPAGO;
  if (/FACTURACION|FACTURACIÓN/.test(f)) return FP.TR_FACT;
  if (/PREPAGADA/.test(f)) return /DAVIVIENDA/.test(f) && /LILIAN/.test(f) ? FP.DAV_LILIAN : FP.PREPAGADA;
  if (/DAVIVIENDA/.test(f)) return /LILIAN/.test(f) ? FP.DAV_LILIAN : FP.DAV;
  if (/BANCOLOMBIA/.test(f)) return /LILIAN/.test(f) ? FP.BC_LILIAN : FP.BC_REHAB;
  if (/TARJETA|TARGETA|DATAFONO|DEBITO|DÉBITO/.test(f)) return FP.TARJETA;
  if (/CREDITO|CRÉDITO|DEUDA/.test(f)) return FP.CREDITO;
  if (/EFECTIVO/.test(f)) return FP.EFECTIVO;
  if (/TRANSFERENCIA|CONSIGNACION|NEQUI|DAVIPLATA|PSE/.test(f)) return FP.BC_REHAB;
  return f;
}

/** Reconoce el prefijo probando primero los más largos, para que «RCR-A-1234» no se lea como «R». */
export function prefijoDocumento(doc: string): string {
  const d = up(doc).trim();
  if (!d) return '';
  for (const p of PREFIJOS_CONOCIDOS) {
    if (d === p) return p;
    const resto = d.slice(p.length);
    if (d.startsWith(p) && /^[-\s]?\d/.test(resto)) return p;
  }
  const m = d.match(/^([A-Z]+(?:-[A-Z])?)-?\d+$/);
  return m ? m[1] : d.replace(/[-\d].*$/, '');
}

/**
 * Devuelve el grupo de la matriz, el status fino, si hubo recaudo hoy, si el
 * documento debe cruzarse con la agenda del día, la cláusula que se aplicó y a
 * dónde fue a parar el resto del dinero.
 */
export function clasificarMovimiento(rec: CajaRecord): ClasificacionMovimiento {
  const pre = prefijoDocumento(rec.documento);
  const regla = REGLAS_DOC[pre] || null;
  const forma = normalizarFormaPago(rec.formaPago);
  const valor = Number(rec.valor) || 0;
  const cero = Math.round(valor) === 0;
  const abono = /^ABONO DOCUMENTO/.test(up(rec.items));
  const nit = esNit(rec.id);
  const empresa = nit || RE_EMPRESA.test(up(rec.nombre)) || RE_EMPRESA.test(up(rec.entidad));
  const anulado = up(rec.estado) === 'A';

  const base = {
    pre, regla, forma,
    tipoDoc: regla ? regla.desc : 'Prefijo no reconocido',
    formasPermitidas: regla ? regla.formas : [],
    formaValida: (regla ? (regla.formas.includes(forma as any) ? 'SI' : 'NO') : 'N/D') as 'SI' | 'NO' | 'N/D',
  };

  if (anulado) {
    return {
      ...base, grupo: 'ANULADO', status: 'ANULADO', hayRecaudo: false, entraAgenda: false,
      clausula: 'Movimiento anulado (ESTADO = A)', destino: 'Movimiento anulado: no suma en ninguna vía de recaudo',
      bloque: 'PAGO_PACIENTE',
    };
  }

  // --- Grupo según la matriz ---
  let grupo: GrupoMatriz;
  let clausula = '';
  if (!regla) {
    grupo = empresa || abono ? 'PAGO DE DEUDA' : 'SIN CLASIFICAR';
    clausula = 'Prefijo fuera de la matriz: clasificado por el tipo de tercero';
  } else if (regla.grupoBase === 'MIXTO_TERCERO') {
    grupo = empresa ? 'RADICADO A ENTIDAD' : 'ASUME PACIENTE';
    clausula = empresa ? 'R con NIT / nombre de empresa → RADICADO A ENTIDAD' : 'R con documento de identidad → ASUME PACIENTE';
  } else if (regla.grupoBase === 'MIXTO_VALOR') {
    grupo = cero ? 'ASUME PACIENTE' : 'PAGO DE DEUDA';
    clausula = cero ? pre + ' con valor 0 → ASUME PACIENTE' : pre + ' con valor distinto de 0 → PAGO DE DEUDA';
  } else {
    grupo = regla.grupoBase as GrupoMatriz;
    clausula = regla.nota || '';
  }

  // --- ¿El documento se cruza contra la agenda del día? ---
  let entraAgenda: boolean;
  if (!regla) entraAgenda = false;
  else if (regla.entraAgenda === 'SOLO_SI_CERO') entraAgenda = cero;
  else entraAgenda = !!regla.entraAgenda;
  if (entraAgenda === false && regla && regla.entraAgenda !== false) {
    clausula += ' · No entra en la agenda del día';
  }

  // --- Status fino según la forma de pago ---
  let status: string;
  let destino = '';
  let hayRecaudo = FORMAS_CON_RECAUDO.includes(forma as any);
  if (forma === FP.ANT_COPAGO || forma === FP.ANT_DESC) {
    status = 'ANTICIPO_APLICADO'; hayRecaudo = false;
    destino = 'Ya recaudado en un anticipo previo (ANTL / ANTR)';
  } else if (forma === FP.CREDITO) {
    status = 'CREDITO_POR_COBRAR'; hayRecaudo = false;
    destino = 'Queda como cartera del paciente; se recauda vía RCE';
  } else if (forma === FP.SIN_VALOR) {
    status = 'SIN_VALOR'; hayRecaudo = false;
    destino = 'Sin valor: lo asume la entidad y se radica';
  } else if (forma === FP.AJUSTE) {
    status = 'AJUSTE_DE_CARTERA'; hayRecaudo = false;
    destino = 'Ajuste contable de cartera: no mueve caja';
  } else if (forma === FP.TR_FACT) {
    status = 'TRANSFERENCIA_FACTURACION'; hayRecaudo = true;
    destino = '';
  } else if (hayRecaudo) {
    status = grupo === 'ANTICIPO RECIBIDO' ? 'ANTICIPO_RECIBIDO' : grupo === 'PAGO DE DEUDA' ? 'RECAUDO_DE_CARTERA' : 'RECAUDO_EN_CAJA';
  } else {
    status = 'SIN_CLASIFICAR';
    destino = 'Forma de pago no reconocida';
  }
  if (cero && hayRecaudo && grupo === 'ASUME PACIENTE') {
    hayRecaudo = false;
    destino = destino || 'Valor 0: lo asume la entidad, no hay recaudo';
  }

  const bloque: 'PAGO_PACIENTE' | 'PAGO_ENTIDADES' = grupo === 'PAGO DE DEUDA' || grupo === 'RADICADO A ENTIDAD' ? 'PAGO_ENTIDADES' : 'PAGO_PACIENTE';
  return { ...base, grupo, status, hayRecaudo, entraAgenda, clausula, destino, bloque };
}
