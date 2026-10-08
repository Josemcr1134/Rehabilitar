/**
 * Reglas de negocio puras de la integración con World Office. Migradas 1:1
 * desde el bloque <script> final de index.html (secciones 2 y 3: REGLAS y
 * CONTROLES DE REVISORÍA FISCAL).
 */
import { CajaRecord } from '../models/records.model';
import { FP } from '../models/clasificacion.model';
import { normalizarFormaPago, prefijoDocumento } from './clasificacion.util';
import { extraerTarifa } from './tarifa.util';
import { up } from './normalizacion.util';
import {
  Asiento, CENTROS, ControlRevisoria, ExcepcionWO, ExcluidoWO, FacturaWO, PRODUCTO, PreparacionWO, ReciboWO, TABLA_A, WO_CONFIG,
} from '../models/world-office.model';

export const fmtCOP = (n: number): string => '$' + Math.round(n || 0).toLocaleString('es-CO');

/** Mayúsculas, sin tildes, espacios colapsados — para comparar texto libre contra las tablas de reglas. */
export const key = (s: unknown): string => up(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function servicioDe(texto: string): string {
  const s = key(texto);
  if (/OCUPACI/.test(s)) return 'TERAPIA OCUPACIONAL';
  if (/FONOAUDIO/.test(s)) return 'FONOAUDIOLOGIA';
  if (/PSICOLOG/.test(s)) return 'PSICOLOGIA';
  if (/FISIOTERAP/.test(s)) return 'FISIOTERAPIA';
  return '';
}

export function centroDe(entidad: string): string {
  const e = key(entidad);
  for (const [re, nombre] of CENTROS) if (re.test(e)) return nombre;
  return '';
}

export function itemsDe(texto: unknown): string[] {
  return String(texto == null ? '' : texto).split(/\s*(?:\||\r?\n)\s*/).map((x) => x.trim()).filter(Boolean);
}

export function conceptoCombinado(formas: string[]): string | null {
  const grupos = new Set(formas.map((f) => TABLA_A[f].grupo));
  const g = [...grupos].sort().join('+');
  if (g === 'PAGO') {
    const p = new Set(formas);
    if (p.size === 2 && p.has(FP.EFECTIVO) && p.has(FP.TARJETA)) return 'PAGO DEL DIA (EFECTIVO-TARJETA)';
    if (p.size === 2 && p.has(FP.EFECTIVO) && p.has(FP.DAV)) return 'PAGO DEL DIA (EFECTIVO-DAVIVIENDA)';
    return null;
  }
  return ({
    'ANTICIPO+PAGO': 'ANTICIPO DESCUENTO/PAGO DEL DIA',
    'CREDITO+PAGO': 'PAGO DEL DIA/CREDITO-DEUDA',
    'ANTICIPO+CREDITO+PAGO': 'PAGO DEL DIA/CREDITO-DEUDA/ANTICIPO DE DESCUENTO',
    'ANTICIPO+CREDITO': 'CREDITO-DEUDA/ANTICIPO DE DESCUENTO',
  } as Record<string, string>)[g] || null;
}

interface FilaConOrden extends CajaRecord { _orden: number }

/**
 * Entrada: registros normalizados de CAJA (AppStateService.caja()).
 * Salida: facturas, recibos, excluidos y excepciones + controles de revisoría.
 */
export function prepararDocumentos(caja: CajaRecord[]): PreparacionWO {
  const facturas: FacturaWO[] = [];
  const recibos: ReciboWO[] = [];
  const excluidos: ExcluidoWO[] = [];
  const excepciones: ExcepcionWO[] = [];
  let totalCaja = 0;
  const porDoc = new Map<string, FilaConOrden[]>();

  caja.forEach((r, i) => {
    totalCaja += Number(r.valor) || 0;
    const k = r.documento || `(sin documento #${i + 1})`;
    if (!porDoc.has(k)) porDoc.set(k, []);
    porDoc.get(k)!.push({ ...r, _orden: i });
  });

  for (const [doc, filas] of porDoc) {
    const r0 = filas[0];
    const pre = prefijoDocumento(doc);
    const m = String(doc).match(/(\d+)\s*$/);
    const numero = m ? Number(m[1]) : null;
    const valor = filas.reduce((s, f) => s + (Number(f.valor) || 0), 0);
    const formas = filas.map((f) => normalizarFormaPago(f.formaPago));
    const empresaKey: 'LILIAN' | 'REHABILITAR' = WO_CONFIG.prefijosLilian.includes(pre) ? 'LILIAN' : 'REHABILITAR';
    const base = {
      documento: doc, prefijo: pre, numero, fecha: r0.fecha, fechaRegistro: String(r0.fechaRegistro || ''),
      orden: r0._orden, cliente: r0.id, nombre: r0.nombre, entidad: r0.entidad, valor,
      anulado: filas.some((f) => up(f.estado) === 'A'), empresaKey, empresa: WO_CONFIG.empresas[empresaKey],
      movimientos: filas.length, formasOrigen: [...new Set(filas.map((f) => String(f.formaPago || '').trim()))].join(' + '),
      avisos: [] as string[],
    };
    const excluir = (motivo: string) => excluidos.push({ ...base, motivo });
    const excepcion = (motivo: string) => excepciones.push({ ...base, motivo });
    const sinValor = Math.round(valor) === 0 || formas.every((f) => f === FP.SIN_VALOR);

    if (numero === null) { excepcion('No se pudo leer el número del documento'); continue; }
    if (!base.cliente) { excepcion('Movimiento sin ID. TERCERO'); continue; }

    // ---------------- FACTURAS: R, COPG, COPL ----------------
    if (WO_CONFIG.prefijosFactura.includes(pre)) {
      if (sinValor) { excluir('Factura sin valor: no contabiliza'); continue; }
      const sinRegla = [...new Set(formas.filter((f) => !TABLA_A[f]))];
      if (sinRegla.length) { excepcion('Forma de pago sin regla en la tabla A: ' + sinRegla.join(', ')); continue; }
      const unicas = [...new Set(formas)];
      let concepto: string;
      if (unicas.length === 1) concepto = TABLA_A[unicas[0]].concepto;
      else {
        const combinado = conceptoCombinado(unicas);
        if (!combinado) { excepcion('Combinación de formas de pago sin concepto combinado: ' + unicas.join(' + ')); continue; }
        concepto = combinado;
      }
      // En una factura combinada el encabezado lleva la forma de pago de mayor valor.
      const principal = filas.slice().sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0))[0];
      const formaWO = TABLA_A[normalizarFormaPago(principal.formaPago)].forma;
      if (unicas.length > 1) base.avisos.push('Pago combinado: el encabezado lleva «' + formaWO + '» (la de mayor valor)');

      const textoItems = r0.itemsRaw !== undefined && r0.itemsRaw !== null && r0.itemsRaw !== '' ? r0.itemsRaw : r0.items;
      const items = itemsDe(textoItems);
      const servicio = servicioDe(items[0] || '');
      if (!servicio) { excepcion('Servicio no reconocido en ITEMS: «' + String(items[0] || '').slice(0, 70) + '»'); continue; }
      const producto = (pre === 'R' ? PRODUCTO.R : PRODUCTO.COP)[servicio];
      const centroCosto = centroDe(base.entidad);
      if (!centroCosto) { excepcion('Entidad sin centro de costos: «' + base.entidad + '»'); continue; }

      // Ítems múltiples: solo se aceptan si VALOR = cantidad × tarifa del paciente.
      let cantidad = 1, valorUnitario = valor;
      if (items.length > 1) {
        const tarifas = items.map(extraerTarifa);
        const servicios = new Set(items.map(servicioDe));
        const pacs = new Set(tarifas.map((t) => (t.detectado ? Math.round(t.pac || 0) : null)));
        const pac = [...pacs][0];
        if (servicios.size === 1 && pacs.size === 1 && pac && Math.abs(valor - items.length * pac) < 1) {
          cantidad = items.length; valorUnitario = pac;
          base.avisos.push(items.length + ' servicios iguales en ITEMS: cantidad ' + cantidad + ' × ' + pac.toLocaleString('es-CO'));
        } else { excepcion('ITEMS trae ' + items.length + ' servicios y el valor no cuadra con cantidad × tarifa'); continue; }
      }
      facturas.push({
        ...base, tipo: 'FV', concepto, formaPagoWO: formaWO, servicio, producto, centroCosto, cantidad, valorUnitario,
        pagos: filas.map((f) => ({ forma: WO_CONFIG.formaPagoDetalle, valor: Number(f.valor) || 0, origen: f.formaPago })),
      });
      continue;
    }

    // ---------------- RECIBOS: anticipos y abonos a deuda ----------------
    const esAnticipo = WO_CONFIG.prefijosReciboAnticipo.includes(pre);
    const esDeuda = WO_CONFIG.prefijosReciboDeuda.includes(pre);
    if (esAnticipo || esDeuda) {
      if (sinValor) { excluir('Recibo sin valor: no contabiliza'); continue; }
      const sinCuenta = [...new Set(formas.filter((f) => !WO_CONFIG.cuentaDebitoPorForma[f]))];
      if (sinCuenta.length) { excepcion('Forma de pago sin cuenta débito en CUENTAS Y CONCEPTOS: ' + sinCuenta.join(', ')); continue; }
      const centroCosto = centroDe(base.entidad);
      if (!centroCosto) base.avisos.push('Entidad sin centro de costos: los asientos van sin centro');
      const concepto = esAnticipo ? WO_CONFIG.conceptoReciboAnticipo : WO_CONFIG.conceptoReciboDeuda;
      const asientos: Asiento[] = filas.filter((f) => Math.round(Number(f.valor) || 0) !== 0).map((f) => {
        const fc = normalizarFormaPago(f.formaPago);
        return { naturaleza: 'D', cuenta: WO_CONFIG.cuentaDebitoPorForma[fc], valor: Number(f.valor) || 0, forma: fc };
      });
      asientos.push({ naturaleza: 'C', cuenta: esAnticipo ? WO_CONFIG.cuentaCreditoAnticipo : WO_CONFIG.cuentaCreditoDeuda, valor });
      recibos.push({ ...base, tipo: 'RC', clase: esAnticipo ? 'ANTICIPO' : 'PAGO DE DEUDA', concepto, centroCosto, asientos });
      continue;
    }

    excluir('Prefijo «' + pre + '» no se carga en World Office (cartera de entidad u otro documento)');
  }

  const orden = (a: { fechaRegistro: string; orden: number }, b: { fechaRegistro: string; orden: number }) =>
    a.fechaRegistro === b.fechaRegistro ? a.orden - b.orden : a.fechaRegistro < b.fechaRegistro ? -1 : 1;
  facturas.sort(orden); recibos.sort(orden);

  const out: PreparacionWO = { facturas, recibos, excluidos, excepciones, totalCaja, movimientos: caja.length, controles: [], porEmpresaForma: {} };
  out.controles = controles(out);
  return out;
}

/** Controles de revisoría fiscal (paso 4 del PROMPT institucional). Muta p.porEmpresaForma, igual que el original. */
export function controles(p: PreparacionWO): ControlRevisoria[] {
  const suma = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((s, x) => s + f(x), 0);
  const c: ControlRevisoria[] = [];
  const vF = suma(p.facturas, (x) => x.valor);
  const vMov = suma(p.facturas, (x) => x.cantidad * x.valorUnitario);
  const vPag = suma(p.facturas, (x) => suma(x.pagos, (y) => y.valor));
  c.push({
    control: 'Integridad: encabezados = movimientos = detalles de pago', ok: true,
    detalle: `${p.facturas.length} facturas → ${p.facturas.length} encabezados, ${p.facturas.length} movimientos, ${suma(p.facturas, (x) => x.pagos.length)} pagos`,
  });
  c.push({
    control: 'Cuadre de valores de facturas', ok: Math.abs(vF - vMov) < 1 && Math.abs(vF - vPag) < 1,
    detalle: `reporte ${fmtCOP(vF)} · movimientos ${fmtCOP(vMov)} · detalles de pago ${fmtCOP(vPag)}`,
  });
  const vR = suma(p.recibos, (x) => x.valor);
  const desc = p.recibos.filter((r) => Math.abs(
    suma(r.asientos.filter((a) => a.naturaleza === 'D'), (a) => a.valor) - suma(r.asientos.filter((a) => a.naturaleza === 'C'), (a) => a.valor),
  ) >= 1);
  c.push({
    control: 'Recibos: débitos = créditos', ok: !desc.length,
    detalle: desc.length ? 'Descuadrados: ' + desc.map((r) => r.documento).join(', ') : `${p.recibos.length} recibos por ${fmtCOP(vR)}`,
  });
  const vX = suma(p.excluidos, (x) => x.valor), vE = suma(p.excepciones, (x) => x.valor);
  c.push({
    control: 'Total caja = facturas + recibos + excluidos + excepciones', ok: Math.abs(p.totalCaja - (vF + vR + vX + vE)) < 1,
    detalle: `${fmtCOP(p.totalCaja)} = ${fmtCOP(vF)} + ${fmtCOP(vR)} + ${fmtCOP(vX)} + ${fmtCOP(vE)}`,
  });
  // Consecutivos por prefijo sobre todos los documentos del reporte.
  const todos = [...p.facturas, ...p.recibos, ...p.excluidos, ...p.excepciones];
  const porPre: Record<string, number[]> = {};
  todos.forEach((d) => { if (d.numero !== null) (porPre[d.prefijo] = porPre[d.prefijo] || []).push(d.numero); });
  const huecos: string[] = [];
  Object.entries(porPre).forEach(([pre, nums]) => {
    nums.sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1]) huecos.push(`${pre}-${nums[i]} duplicado`);
      else if (nums[i] - nums[i - 1] > 1) huecos.push(nums[i] - nums[i - 1] === 2 ? `${pre}-${nums[i - 1] + 1}` : `${pre}-${nums[i - 1] + 1} a ${pre}-${nums[i] - 1}`);
    }
  });
  c.push({ control: 'Consecutivos por prefijo sin saltos ni duplicados', ok: !huecos.length, detalle: huecos.length ? 'Faltan / revisar: ' + huecos.join(', ') : 'Sin saltos' });
  c.push({ control: 'Excepciones para decisión de contabilidad', ok: !p.excepciones.length, detalle: p.excepciones.length ? `${p.excepciones.length} documento(s) detenidos por ${fmtCOP(vE)}` : 'Ninguna' });
  const anuladas = [...p.facturas.filter((f) => f.anulado), ...p.recibos.filter((r) => r.anulado)];
  c.push({ control: 'Anulados (se crean y se anulan en WO)', ok: true, detalle: anuladas.length ? anuladas.map((a) => `${a.documento} ${fmtCOP(a.valor)}`).join(', ') : 'Ninguno' });
  // Cuadre por empresa y forma de pago.
  p.porEmpresaForma = {};
  p.facturas.forEach((f) => f.pagos.forEach((pg) => {
    const k = f.empresaKey + ' · ' + String(pg.origen || '').trim().toUpperCase();
    p.porEmpresaForma[k] = (p.porEmpresaForma[k] || 0) + pg.valor;
  }));
  return c;
}
