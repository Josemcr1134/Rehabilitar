/**
 * TARIFAS SOBRE LOS ARCHIVOS DE ORIGEN. Migrado 1:1 desde index.html
 * (analizarOrigenTarifas / puenteAgenda). Recorre las tres hojas tal como
 * llegaron (la matriz cruda guardada en ArchivoCargado) y deriva, renglón por
 * renglón, VALOR TARIFA / ASUME PACIENTE / ASUME ENTIDAD desde el texto de
 * REFERENCIA (agenda), ITEMS (caja) y DESCRIPCION (consumo).
 */
import { TipoFuente } from '../models/records.model';
import { EstadoDiferencia, OrigenTarifas, PuenteAgenda } from '../models/conciliacion-resultado.model';
import { ArchivoCargado } from '../services/excel-import.service';
import { findCol, normFecha, normId, normNombre, toNumber, up } from './normalizacion.util';
import { limpiarServicio, extraerTarifa, itemsDeCampo, tarifaDeCampo } from './tarifa.util';
import { esNit, normalizarFormaPago, prefijoDocumento } from './clasificacion.util';
import { FP } from '../models/clasificacion.model';

const CAMPO_SERVICIO: Record<TipoFuente, string[]> = {
  AGENDA: ['REFERENCIA', 'SERVICIO', 'CONCEPTO'],
  CAJA: ['ITEMS', 'ITEM', 'CONCEPTO'],
  CONSUMO: ['DESCRIPCION', 'DESCRIPCIÓN', 'SERVICIO'],
};

/**
 * ASUME PACIENTE EN CAJA (pago del día, anticipo descuento y crédito deuda) = lo que el paciente
 * asume en la facturación de su servicio: documentos de factura R, COPG, COPL y LA de terceros con
 * cédula (no NIT de entidad), sin anulados. Es la misma regla del consolidado de caja («B1 Asume
 * paciente») y de las notas contables APR/APLR.
 *   - Fuera quedan los abonos a deuda (RCR-A, RCL-A), los anticipos recibidos (ANTR, ANTL),
 *     la cartera de entidades (RCE, RCEL o tercero con NIT) y los anulados.
 * PAGO DEL DIA = esa facturación pagada hoy en efectivo, tarjeta o transferencia.
 */
const PREF_FACTURA_PACIENTE = ['COPG', 'COPL', 'R', 'LA'];
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
    anulados: [], cajaMovimientos: 0, citasNoCumplidas: 0,
    fueraAsumePaciente: { abonosDeuda: 0, anticiposRecibidos: 0, entidades: 0, otros: 0 },
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
    const cFecha = findCol(headers, ['FECHA', 'FECHA FACTURA']);
    const cFechaReg = findCol(headers, ['FECHA REGISTRO']);
    const cNombre = findCol(headers, ['NOM TERCERO', 'NOMBRE PACIENTE', 'NOMBRE CLIENTE']);
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
        // Solo las citas CUMPLIDAS generan venta (igual que las notas contables). Si el reporte no
        // trae ESTADO se cuentan todas, como antes.
        const estado = up(cEstatus >= 0 ? fila[cEstatus] : '');
        if (estado && estado !== 'CUMPLIDA') { out.citasNoCumplidas++; continue; }
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
        const docTxt = cDoc >= 0 ? String(fila[cDoc] ?? '').trim() : '';
        if (!cruda && !docTxt) continue; // filas vacías o de totales
        out.cajaMovimientos++;
        // «Total reporte de caja»: la suma de VALOR tal como la trae el reporte (incluye anulados).
        if (cruda) { formas.set(cruda, (formas.get(cruda) || 0) + valor); out.totalCaja += valor; }
        // Un documento anulado (ESTADO = A) se conserva con su valor original para consultarlo,
        // pero no cuenta como pago, anticipo, crédito ni recaudo: no es una operación activa.
        if (up(cEstatus >= 0 ? fila[cEstatus] : '') === 'A') {
          out.anulados.push({
            documento: docTxt, fecha: normFecha(cFecha >= 0 ? fila[cFecha] : ''),
            fechaRegistro: cFechaReg >= 0 ? String(fila[cFechaReg] ?? '').trim() : '',
            id: normId(cId >= 0 ? fila[cId] : ''), nombre: normNombre(cNombre >= 0 ? fila[cNombre] : ''),
            formaPago: cruda, valor,
          });
          continue;
        }
        const canon = normalizarFormaPago(cruda);
        if (FORMAS_RECAUDO_REAL.indexOf(canon) >= 0) out.recaudoReal += valor;
        const pre = prefijoDocumento(docTxt);
        const items = up(cServ >= 0 ? fila[cServ] : '');
        const esEntidad = esNit(normId(cId >= 0 ? fila[cId] : '')) || /^ABONO DOCUMENTO|ABONO\s+DOCUMENTO/.test(items) || pre === 'RCE' || pre === 'RCEL';
        let asume = false;
        if (PREF_FACTURA_PACIENTE.indexOf(pre) >= 0 && !esEntidad) {
          if (canon === FP.CREDITO) { out.credito += valor; asume = true; }
          else if (canon === FP.ANT_DESC) { out.anticipoDescuento += valor; asume = true; }
          else if (FORMAS_PAGO_DIA.indexOf(canon as any) >= 0) {
            out.pagoDelDia += valor; out.pagoDelDiaMov++; asume = true;
            out.pagoDelDiaPorPrefijo[pre] = (out.pagoDelDiaPorPrefijo[pre] || 0) + valor;
          }
        }
        if (!asume) {
          // Lo que no es «asume paciente» se explica aparte, para que el total del reporte cuadre.
          const f = out.fueraAsumePaciente;
          if (esEntidad) {
            f.entidades += valor;
            if (PREF_FACTURA_PACIENTE.indexOf(pre) >= 0) { out.conNit += valor; out.conNitMov++; }
          } else if (pre === 'RCR-A' || pre === 'RCL-A') f.abonosDeuda += valor;
          else if (pre === 'ANTR' || pre === 'ANTL') f.anticiposRecibidos += valor;
          else f.otros += valor;
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

/** Pesos con centavos sin errores de coma flotante (0.1 + 0.2 ≠ 0.3). */
export const redondearCOP = (n: number): number => Math.round((n || 0) * 100) / 100;

/**
 * DIFERENCIA NO CONCILIADA = asume paciente de la agenda − (pago del día + anticipo descuento + crédito deuda).
 * Positiva: falta conciliar (lo agendado no aparece en caja). Negativa: en caja hay más de lo agendado.
 * Si no hay citas con tarifa ni movimientos de caja, no es «cuadra»: es «sin movimientos».
 */
export function diferenciaNoConciliada(pacAgenda: number, caja: { pagoDelDia: number; anticipoDescuento: number; credito: number },
  hayDatos: boolean): { valor: number; estado: EstadoDiferencia } {
  const valor = redondearCOP(pacAgenda - (caja.pagoDelDia + caja.anticipoDescuento + caja.credito));
  if (!hayDatos) return { valor: 0, estado: 'SIN MOVIMIENTOS' };
  if (Math.abs(valor) < 0.005) return { valor: 0, estado: 'CUADRA' };
  return { valor, estado: valor > 0 ? 'PENDIENTE' : 'EXCEDENTE' };
}

/** El puente entre lo vendido en la agenda y lo recaudado en caja. */
export function puenteAgenda(o: OrigenTarifas, facturadoEntidadManual: number): PuenteAgenda {
  const fe = isFinite(facturadoEntidadManual) && facturadoEntidadManual > 0
    ? facturadoEntidadManual
    : o.facturadoEntidadConsumo || o.radicadoEntidad;
  const totalAsumePaciente = redondearCOP(o.pagoDelDia + o.anticipoDescuento + o.credito);
  const dif = diferenciaNoConciliada(o.agenda.pac, o, o.agenda.detectadas > 0 || (o.cajaMovimientos || 0) > 0);
  return {
    totalVenta: o.agenda.tar, sesiones: o.agenda.sesiones,
    pac: o.agenda.pac, ent: o.agenda.ent,
    pagoDelDia: o.pagoDelDia, anticipoDescuento: o.anticipoDescuento, credito: o.credito,
    difNoConciliada: dif.valor, estadoDiferencia: dif.estado, totalAsumePaciente,
    recaudoAgenda: o.agenda.tar, recaudoReal: o.recaudoReal, difRecaudo: o.recaudoReal - o.agenda.tar,
    facturadoEntidad: fe, noFacturadoEntidad: o.agenda.ent - fe,
  };
}
