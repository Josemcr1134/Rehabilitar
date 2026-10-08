/**
 * TARIFAS SOBRE LOS ARCHIVOS DE ORIGEN. Migrado 1:1 desde index.html
 * (analizarOrigenTarifas / puenteAgenda). Recorre las tres hojas tal como
 * llegaron (la matriz cruda guardada en ArchivoCargado) y deriva, renglón por
 * renglón, VALOR TARIFA / ASUME PACIENTE / ASUME ENTIDAD desde el texto de
 * REFERENCIA (agenda), ITEMS (caja) y DESCRIPCION (consumo).
 */
import { TipoFuente } from '../models/records.model';
import { OrigenTarifas, PuenteAgenda } from '../models/conciliacion-resultado.model';
import { ArchivoCargado } from '../services/excel-import.service';
import { findCol, normId, toNumber, up } from './normalizacion.util';
import { limpiarServicio, extraerTarifa, itemsDeCampo, tarifaDeCampo } from './tarifa.util';
import { esNit, normalizarFormaPago, prefijoDocumento } from './clasificacion.util';
import { FP } from '../models/clasificacion.model';

const CAMPO_SERVICIO: Record<TipoFuente, string[]> = {
  AGENDA: ['REFERENCIA', 'SERVICIO', 'CONCEPTO'],
  CAJA: ['ITEMS', 'ITEM', 'CONCEPTO'],
  CONSUMO: ['DESCRIPCION', 'DESCRIPCIÓN', 'SERVICIO'],
};

/**
 * PAGO DEL DIA = lo que se pagó hoy en caja contra un documento de servicio.
 * Documentos con prefijo COPG, COPL, R y RCL-A, pagados en efectivo, tarjeta o
 * transferencia (Bancolombia Lilian/Rehabilitar y Davivienda). Los prefijos ya
 * dejan fuera la cartera de las aseguradoras (RCE, RCEL, LA).
 */
const PREF_PAGO_DIA = ['COPG', 'COPL', 'R', 'RCL-A'];
const FORMAS_PAGO_DIA = [FP.EFECTIVO, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV];

/**
 * RECAUDO REAL = toda la plata que efectivamente entró por caja, sin importar a
 * quién se le atribuya. Quedan fuera ANTICIPO DESCUENTO, CREDITO-DEUDA, AJUSTE
 * CARTERA, SIN VALOR y TRANSFERENCIAS FACTURACION.
 */
const FORMAS_RECAUDO_REAL: string[] = [FP.EFECTIVO, FP.TARJETA, FP.BC_LILIAN, FP.BC_REHAB, FP.DAV, FP.DAV_LILIAN, FP.PREPAGADA];

export function analizarOrigenTarifas(raw: Partial<Record<TipoFuente, ArchivoCargado>>, radicadoEntidadValor: number): OrigenTarifas {
  const out: OrigenTarifas = {
    hojas: {},
    agenda: { tar: 0, pac: 0, ent: 0, sesiones: 0, detectadas: 0 },
    formasPago: [], totalCaja: 0,
    pagoDelDia: 0, pagoDelDiaMov: 0, pagoDelDiaPorPrefijo: {},
    conNit: 0, conNitMov: 0,
    credito: 0, anticipoDescuento: 0, recaudoReal: 0,
    radicadoEntidad: 0, facturadoEntidadConsumo: 0, tarifario: [],
  };
  const catalogo = new Map<string, { servicio: string; t: ReturnType<typeof extraerTarifa>; ag: number; cj: number; co: number }>();
  const formas = new Map<string, number>();

  (['AGENDA', 'CAJA', 'CONSUMO'] as TipoFuente[]).forEach((tipo, slot) => {
    const src = raw[tipo];
    if (!src || !src.matriz || !src.matriz.length) return;
    const fEnc = Math.max(1, Number(src.filaEnc) || 1);
    const headers = (src.headers && src.headers.length ? src.headers : (src.matriz[fEnc - 1] as string[])) || [];
    const cServ = findCol(headers, CAMPO_SERVICIO[tipo]);
    const cDoc = findCol(headers, ['NUM. DOCUMENTO', 'NUMERO DOCUMENTO', 'DOCUMENTO']);
    const cForma = findCol(headers, ['FORMA PAGO', 'FORMA DE PAGO']);
    const cValor = findCol(headers, ['VALOR', 'VLR']);
    const cId = findCol(headers, ['ID. TERCERO', 'ID TERCERO', 'IDENTIFICACION']);
    const cEstatus = findCol(headers, ['ESTATUS', 'ESTADO']);
    const cNeto = findCol(headers, ['VLR. NETO', 'VALOR NETO']);
    const filas: ReturnType<typeof tarifaDeCampo>[] = [];

    for (let n = fEnc; n < src.matriz.length; n++) {
      const fila = (src.matriz[n] || []) as unknown[];
      const texto = cServ >= 0 ? fila[cServ] : '';
      const t = tarifaDeCampo(texto);
      filas.push(t);

      itemsDeCampo(texto).forEach((parte) => {
        const base = limpiarServicio(parte);
        if (!base || /^ABONO/.test(base)) return;
        if (!catalogo.has(base)) catalogo.set(base, { servicio: base, t: extraerTarifa(parte), ag: 0, cj: 0, co: 0 });
        const c = catalogo.get(base)!;
        if (slot === 0) c.ag++; else if (slot === 1) c.cj++; else c.co++;
      });

      if (tipo === 'AGENDA') {
        out.agenda.sesiones++;
        if (t.detectado) { out.agenda.detectadas++; out.agenda.tar += t.tar || 0; out.agenda.pac += t.pac || 0; out.agenda.ent += t.ent || 0; }
      }
      if (tipo === 'CONSUMO') {
        // FACTURADO A ENTIDAD = VLR. NETO de lo ya facturado (ESTATUS=F) en convenio.
        // En particular y PROBIENESTAR el VLR. NETO es plata del paciente, no de la entidad.
        const est = up(cEstatus >= 0 ? fila[cEstatus] : '');
        if (est === 'F' && t.tipo === 'CONVENIO') out.facturadoEntidadConsumo += cNeto >= 0 ? toNumber(fila[cNeto]) || 0 : 0;
      }
      if (tipo === 'CAJA') {
        const valor = cValor >= 0 ? toNumber(fila[cValor]) || 0 : 0;
        const cruda = up(cForma >= 0 ? fila[cForma] : '').replace(/\s+/g, ' ').trim();
        if (cruda) { formas.set(cruda, (formas.get(cruda) || 0) + valor); out.totalCaja += valor; }
        const canon = normalizarFormaPago(cruda);
        if (canon === FP.CREDITO) out.credito += valor;
        if (canon === FP.ANT_DESC) out.anticipoDescuento += valor;
        if (FORMAS_RECAUDO_REAL.indexOf(canon) >= 0) out.recaudoReal += valor;
        const pre = prefijoDocumento(cDoc >= 0 ? String(fila[cDoc] ?? '') : '');
        if (PREF_PAGO_DIA.indexOf(pre) >= 0 && FORMAS_PAGO_DIA.indexOf(canon as any) >= 0) {
          out.pagoDelDia += valor; out.pagoDelDiaMov++;
          out.pagoDelDiaPorPrefijo[pre] = (out.pagoDelDiaPorPrefijo[pre] || 0) + valor;
          // Se cuentan aparte los terceros con NIT: entran en el total, pero conviene
          // tenerlos a la vista porque son entidades pagando en caja.
          if (esNit(normId(cId >= 0 ? fila[cId] : ''))) { out.conNit += valor; out.conNitMov++; }
        }
      }
    }
    out.hojas[tipo] = { fEnc, cServ, filas };
  });

  out.formasPago = [...formas.entries()].map(([forma, valor]) => ({ forma, valor })).sort((a, b) => a.forma.localeCompare(b.forma, 'es'));
  out.radicadoEntidad = radicadoEntidadValor || 0;
  out.tarifario = [...catalogo.values()].sort((a, b) => a.servicio.localeCompare(b.servicio, 'es'));
  return out;
}

/** El puente entre lo vendido en la agenda y lo recaudado en caja. */
export function puenteAgenda(o: OrigenTarifas, facturadoEntidadManual: number): PuenteAgenda {
  const fe = isFinite(facturadoEntidadManual) && facturadoEntidadManual > 0
    ? facturadoEntidadManual
    : o.facturadoEntidadConsumo || o.radicadoEntidad;
  return {
    totalVenta: o.agenda.tar, sesiones: o.agenda.sesiones,
    pac: o.agenda.pac, ent: o.agenda.ent,
    pagoDelDia: o.pagoDelDia, anticipoDescuento: o.anticipoDescuento, credito: o.credito,
    difNoConciliada: o.agenda.pac - (o.pagoDelDia + o.anticipoDescuento + o.credito),
    recaudoAgenda: o.agenda.tar, recaudoReal: o.recaudoReal, difRecaudo: o.recaudoReal - o.agenda.tar,
    facturadoEntidad: fe, noFacturadoEntidad: o.agenda.ent - fe,
  };
}
