import { Injectable, signal } from '@angular/core';
import ExcelJS from 'exceljs';
import { normId } from '../utils/normalizacion.util';
import { encontrarArrayObjetos } from '../utils/json.util';
import { key } from '../utils/world-office.util';
import { descargar } from '../utils/descargar.util';
import {
  CatalogosWO, EntidadCatalogo, FacturaWO, FilaBitacora, OpcionesEnvio, PreparacionWO, ReciboWO, WO_CONFIG,
} from '../models/world-office.model';

/** Error de la API de World Office: incluye el status HTTP y el JSON crudo (si lo hubo). */
export class WoApiError extends Error {
  constructor(message: string, readonly status: number, readonly json: any = null, readonly duplicadoCheck = false) {
    super(message);
  }
}

type DocumentoWO = FacturaWO | ReciboWO;

/**
 * Cliente de la API de World Office + orquestador de "preparar → conectar →
 * simular/enviar". Migrado 1:1 desde el bloque <script> final de index.html
 * (secciones 4 a 7: CLIENTE DE LA API, ARMADO DE PAYLOADS, ENVÍO, PLANTILLA EXCEL).
 *
 * Usa `fetch` nativo (no HttpClient) a propósito: el original ya hablaba
 * directo con `fetch` contra `/wo` (el rewrite de vercel.json / proxy.conf.json),
 * y las respuestas de error de esta API traen el mensaje en campos variables
 * (userMessage/detail/title) que el cuerpo de este método ya sabe leer tal cual.
 */
@Injectable({ providedIn: 'root' })
export class WorldOfficeService {
  readonly token = signal('');
  readonly cat = signal<CatalogosWO | null>(null);
  readonly prep = signal<PreparacionWO | null>(null);
  readonly log = signal<FilaBitacora[]>([]);
  private cache: { terceros: Record<string, EntidadCatalogo | null>; inventarios: Record<string, EntidadCatalogo | null>; cuentas: Record<string, EntidadCatalogo | null> } =
    { terceros: {}, inventarios: {}, cuentas: {} };

  private async woFetch(method: string, ruta: string, body?: unknown): Promise<any> {
    const resp = await fetch(WO_CONFIG.apiBase + ruta, {
      method,
      headers: { Authorization: WO_CONFIG.authPrefix + this.token(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* respuesta no-JSON, se maneja abajo */ }
    if (!resp.ok) {
      const msg = (json && (json.userMessage || json.detail || json.title || (json.developerMessage && JSON.stringify(json.developerMessage))))
        || raw.slice(0, 300) || resp.statusText;
      throw new WoApiError(`HTTP ${resp.status}: ${msg}`, resp.status, json);
    }
    return json;
  }

  private lista(json: any): unknown[] {
    if (!json) return [];
    const d = json.data !== undefined && json.data !== null ? json.data : json;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.content)) return d.content;
    return encontrarArrayObjetos(d) || [];
  }

  private async listarTodo(ruta: string, filtros?: unknown[]): Promise<any[]> {
    const porPagina = 100; let pagina = 0, acumulado: any[] = [];
    while (pagina < 50) {
      const json = await this.woFetch('POST', ruta, {
        columnaOrdenar: 'id', pagina, registrosPorPagina: porPagina, orden: 'ASC', filtros: filtros || [], canal: 0, registroInicial: pagina * porPagina,
      });
      const arr = this.lista(json);
      acumulado = acumulado.concat(arr);
      if (arr.length < porPagina) break;
      pagina++;
    }
    return acumulado;
  }

  private async porRuta(cacheName: 'terceros' | 'inventarios' | 'cuentas', ruta: string): Promise<EntidadCatalogo | null> {
    const c = this.cache[cacheName];
    if (ruta in c) return c[ruta];
    try {
      const json = await this.woFetch('GET', ruta);
      const d = json && json.data !== undefined ? json.data : json;
      c[ruta] = Array.isArray(d) ? d[0] || null : d && Array.isArray(d.content) ? d.content[0] || null : d || null;
    } catch (e) {
      if (e instanceof WoApiError && (e.status === 404 || e.status === 400)) c[ruta] = null; else throw e;
    }
    return c[ruta];
  }

  private tercero(ident: string) { return this.porRuta('terceros', '/terceros/identificacion/' + encodeURIComponent(normId(ident))); }
  private inventario(codigo: string) { return this.porRuta('inventarios', '/inventarios/consultaCodigo/' + encodeURIComponent(codigo)); }
  private cuenta(codigo: string) { return this.porRuta('cuentas', '/cuentasContables/consultaCodigo/' + encodeURIComponent(codigo)); }

  private prefijoWO(pre: string): string { return WO_CONFIG.prefijoWO[pre] || pre; }

  async cargarCatalogos(): Promise<CatalogosWO> {
    const cat: CatalogosWO = { empresas: {}, prefijos: { FV: {}, RC: {} }, formasVenta: {}, formasContables: {}, monedas: {}, bodegas: {}, centros: {}, errores: [] };
    const intento = async (nombre: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e) {
        cat.errores.push(nombre + ': ' + (e instanceof Error ? e.message : String(e)));
        if (e instanceof WoApiError && e.status === 401) throw e;
      }
    };
    await intento('Empresas', async () => (await this.listarTodo('/empresas/listarEmpresas')).forEach((e: any) => { cat.empresas[key(e.nombre)] = e; }));
    for (const tipo of ['FV', 'RC'] as const) {
      await intento('Prefijos ' + tipo, async () => (await this.listarTodo('/documentosTipos/listarPrefijoDocumento', [{
        atributo: 'codigoDocumento', valor: '', valor2: null, tipoFiltro: 0, tipoDato: 0, nombreColumna: null,
        valores: [tipo], clase: 'documentoTipoes', operador: 0, subGrupo: 'filtro',
      }])).forEach((p: any) => { cat.prefijos[tipo][key(p.nombre)] = p; }));
    }
    await intento('Formas de pago', async () => (await this.listarTodo('/formasDePago/listarFormaPagoDocumento')).forEach((f: any) => {
      cat.formasVenta[key(f.nombre)] = f; if (f.codigo) cat.formasVenta[key(f.codigo)] = cat.formasVenta[key(f.codigo)] || f;
    }));
    await intento('Formas de pago contables', async () => (await this.listarTodo('/contabilidad/listarFormasPagoContable')).forEach((f: any) => { cat.formasContables[key(f.nombre)] = f; }));
    await intento('Monedas', async () => (await this.listarTodo('/monedas/listarMonedas')).forEach((m: any) => { cat.monedas[key(m.codigo)] = m; cat.monedas[key(m.nombre)] = m; }));
    await intento('Bodegas', async () => (await this.listarTodo('/bodegas/listarBodega')).forEach((b: any) => { cat.bodegas[key(b.nombre)] = b; if (b.codigo) cat.bodegas[key(b.codigo)] = b; }));
    await intento('Centros de costo', async () => (await this.listarTodo('/centrosDeCosto/listarCentroCosto')).forEach((c: any) => { cat.centros[key(c.nombre)] = c; }));
    return cat;
  }

  async conectar(token: string, authPrefix: string): Promise<{ ok: boolean; mensaje: string }> {
    this.token.set(token.trim());
    WO_CONFIG.authPrefix = authPrefix;
    if (!this.token()) return { ok: false, mensaje: 'Pega el token de la API de World Office.' };
    this.cache = { terceros: {}, inventarios: {}, cuentas: {} };
    try {
      const cat = await this.cargarCatalogos();
      this.cat.set(cat);
      return { ok: true, mensaje: `Conectado. ${Object.keys(cat.empresas).length} empresa(s), ${Object.keys(cat.prefijos.FV).length} prefijo(s) FV, ${Object.keys(cat.prefijos.RC).length} prefijo(s) RC.` };
    } catch (e) {
      this.cat.set(null);
      if (e instanceof WoApiError) {
        if (e.status === 401 || e.status === 403) return { ok: false, mensaje: `World Office rechazó el token (${e.status}). Revisa que esté vigente y el prefijo «WO ».` };
        if (e.status === 404) return { ok: false, mensaje: 'No se encontró /wo: revisa el rewrite de vercel.json y vuelve a desplegar.' };
      }
      return { ok: false, mensaje: 'No se pudo conectar: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  // ---------------- ARMADO DE PAYLOADS ----------------
  async armarFactura(f: FacturaWO, conservarNumero: boolean): Promise<{ payload?: any; falta?: string[] }> {
    const cat = this.cat(); if (!cat) return { falta: ['sin catálogos: conecta primero'] };
    const falta: string[] = [];
    const empresa = cat.empresas[key(f.empresa)]; if (!empresa) falta.push('empresa «' + f.empresa.trim() + '»');
    const pref = cat.prefijos.FV[key(this.prefijoWO(f.prefijo))]; if (!pref) falta.push('prefijo FV «' + this.prefijoWO(f.prefijo) + '»');
    const forma = cat.formasVenta[key(f.formaPagoWO)]; if (!forma) falta.push('forma de pago «' + f.formaPagoWO + '»');
    const moneda = cat.monedas[key(WO_CONFIG.monedaCodigo)]; if (!moneda) falta.push('moneda ' + WO_CONFIG.monedaCodigo);
    const bodega = cat.bodegas[key(WO_CONFIG.bodega)]; if (!bodega) falta.push('bodega «' + WO_CONFIG.bodega + '»');
    const centro = cat.centros[key(f.centroCosto)]; if (!centro) falta.push('centro de costos «' + f.centroCosto + '»');
    const cliente = await this.tercero(f.cliente); if (!cliente) falta.push('cliente ' + f.cliente + ' (crearlo en WO)');
    const vendedor = await this.tercero(WO_CONFIG.vendedorIdentificacion); if (!vendedor) falta.push('vendedor ' + WO_CONFIG.vendedorIdentificacion);
    const prod = await this.inventario(f.producto); if (!prod) falta.push('producto «' + f.producto + '»');
    if (falta.length) return { falta };
    const unidad = (prod!['unidadMedida'] as any)?.codigo || WO_CONFIG.unidadMedida;
    const payload: any = {
      fecha: f.fecha, prefijo: pref.id, documentoTipo: 'FV', concepto: f.concepto,
      idEmpresa: empresa.id, idTerceroExterno: cliente!.id, idTerceroInterno: vendedor!.id,
      idFormaPago: forma.id, idMoneda: moneda.id, trm: 1,
      reglones: [{
        idInventario: prod!.id, unidadMedida: unidad, cantidad: f.cantidad, valorUnitario: f.valorUnitario,
        valorTotal: f.cantidad * f.valorUnitario, idBodega: bodega.id, idCentroCosto: centro.id,
        concepto: f.concepto, porDescuento: 0,
      }],
    };
    if (conservarNumero) payload.numero = f.numero;
    return { payload };
  }

  async armarRecibo(r: ReciboWO): Promise<{ payload?: any; falta?: string[] }> {
    const cat = this.cat(); if (!cat) return { falta: ['sin catálogos: conecta primero'] };
    const falta: string[] = [];
    const empresa = cat.empresas[key(r.empresa)]; if (!empresa) falta.push('empresa «' + r.empresa.trim() + '»');
    const pref = cat.prefijos.RC[key(this.prefijoWO(r.prefijo))]; if (!pref) falta.push('prefijo RC «' + this.prefijoWO(r.prefijo) + '»');
    const ter = await this.tercero(r.cliente); if (!ter) falta.push('tercero ' + r.cliente + ' (crearlo en WO)');
    const centro = r.centroCosto ? cat.centros[key(r.centroCosto)] : null;
    if (r.centroCosto && !centro) falta.push('centro de costos «' + r.centroCosto + '»');
    const asientos: any[] = [];
    for (const a of r.asientos) {
      const cta = await this.cuenta(a.cuenta);
      if (!cta) { falta.push('cuenta contable ' + a.cuenta); continue; }
      const as: any = {
        cuentaContableId: cta.id, concepto: r.concepto, terceroId: ter ? ter.id : null,
        valorDebito: a.naturaleza === 'D' ? a.valor : 0, valorCredito: a.naturaleza === 'C' ? a.valor : 0,
      };
      if (centro) as.centroCostosId = centro.id;
      if (a.naturaleza === 'D') {
        const nombreFp = WO_CONFIG.formaPagoContable[a.forma!];
        if (nombreFp) {
          const fp = cat.formasContables[key(nombreFp)];
          if (!fp) falta.push('forma de pago contable «' + nombreFp + '»'); else as.formaPago = { formaPagoId: fp.id };
        }
      }
      asientos.push(as);
    }
    if (falta.length) return { falta };
    return { payload: { documentoTipo: 'RC', fecha: r.fecha, empresaId: empresa.id, terceroId: ter!.id, prefijoId: pref.id, concepto: r.concepto, asientos } };
  }

  /** Evita reenviar un documento que ya existe en WO (mismo prefijo y número). Los RC no admiten número propio: solo se verifican las FV. */
  private async buscarExistente(d: DocumentoWO): Promise<EntidadCatalogo | null> {
    const ruta = d.tipo === 'FV' ? '/documentos/listarDocumentoVenta' : '/contabilidad/listarDocContable';
    const json = await this.woFetch('POST', ruta, {
      columnaOrdenar: 'id', pagina: 0, registrosPorPagina: 20, orden: 'DESC', canal: 0, registroInicial: 0,
      filtros: [
        { atributo: 'documentoTipo.codigoDocumento', valor: d.tipo, valor2: null, tipoFiltro: 0, tipoDato: 0, nombreColumna: null, valores: null, clase: null, operador: 0, subGrupo: 'filtro' },
        { atributo: 'numero', valor: String(d.numero), valor2: null, tipoFiltro: 0, tipoDato: 4, nombreColumna: null, valores: null, clase: null, operador: 0, subGrupo: 'filtro' },
      ],
    });
    const pre = key(this.prefijoWO(d.prefijo));
    return (this.lista(json) as any[]).find((x) => Number(x.numero) === d.numero
      && key(typeof x.prefijo === 'object' && x.prefijo ? x.prefijo.nombre : x.prefijo) === pre
      && (!x.empresa || key(typeof x.empresa === 'object' ? x.empresa.nombre : x.empresa) === key(d.empresa))) || null;
  }

  private async yaExiste(d: DocumentoWO): Promise<EntidadCatalogo | null> {
    try { return await this.buscarExistente(d); }
    catch (e) {
      const msg = 'No se pudo verificar si ya existe (' + (e instanceof Error ? e.message : String(e)) + '). Se detuvo el envío para no duplicar; si el error persiste, desmarca «Verificar duplicados» solo después de revisar en World Office.';
      throw new WoApiError(msg, e instanceof WoApiError ? e.status : 0, null, true);
    }
  }

  // ---------------- ENVÍO ----------------
  async enviar(simular: boolean, docs: DocumentoWO[], opciones: OpcionesEnvio, onProgreso?: (i: number, total: number, doc: string) => void): Promise<{ ok: number; total: number; detenido: string | null }> {
    const nuevoLog: FilaBitacora[] = [];
    let detenido: string | null = null;
    let i = 0;
    for (const d of docs) {
      i++; onProgreso?.(i, docs.length, d.documento);
      const fila: FilaBitacora = { documento: d.documento, tipo: d.tipo, valor: d.valor, estado: '', idWO: '', numeroWO: '', detalle: '', payload: null };
      try {
        const { payload, falta } = d.tipo === 'FV' ? await this.armarFactura(d, opciones.conservarNumero) : await this.armarRecibo(d);
        if (falta) { fila.estado = 'FALTA EN WO'; fila.detalle = 'No existe en World Office: ' + falta.join('; '); nuevoLog.push(fila); this.log.set([...nuevoLog]); continue; }
        fila.payload = payload;
        if (simular) { fila.estado = 'SIMULADO'; fila.detalle = 'Payload listo, no se envió'; nuevoLog.push(fila); this.log.set([...nuevoLog]); continue; }

        if (d.tipo === 'FV' && opciones.verificarDuplicados) {
          const ex = await this.yaExiste(d);
          if (ex) { fila.estado = 'YA EXISTE'; fila.idWO = ex.id; fila.detalle = 'Ya estaba en World Office: no se reenvió'; nuevoLog.push(fila); this.log.set([...nuevoLog]); continue; }
        }
        const resp = await this.woFetch('POST', d.tipo === 'FV' ? '/documentos/crearDocumentoVenta' : '/contabilidad/crearDocContable', payload);
        const data = (resp && resp.data) || {};
        fila.idWO = data.id || ''; fila.numeroWO = data.numero || '';
        const notas: string[] = [];
        if (d.tipo === 'FV' && opciones.conservarNumero && fila.numeroWO && Number(fila.numeroWO) !== d.numero) notas.push(`OJO: WO asignó el número ${fila.numeroWO} y no ${d.numero}`);
        if (d.tipo === 'RC') notas.push(`recibo ${d.documento} quedó con el consecutivo WO ${fila.numeroWO || '(sin número)'}`);
        if (d.tipo === 'FV' && opciones.contabilizar && fila.idWO) {
          try { await this.woFetch('POST', '/documentos/contabilizarDocumento/' + fila.idWO); notas.push('contabilizada'); }
          catch (e) { notas.push('creada pero NO contabilizada: ' + (e instanceof Error ? e.message : String(e))); }
        }
        if (d.anulado && fila.idWO) {
          try { await this.woFetch('POST', (d.tipo === 'FV' ? '/documentos/anularDocumento/' : '/contabilidad/anularDocumento/') + fila.idWO); notas.push('anulada'); }
          catch (e) { notas.push('creada pero NO anulada: ' + (e instanceof Error ? e.message : String(e))); }
        }
        fila.estado = notas.some((n) => /NO |OJO/.test(n)) ? 'CREADO CON NOVEDAD' : 'CREADO';
        fila.detalle = (resp && resp.userMessage ? resp.userMessage + ' · ' : '') + notas.join(' · ');
      } catch (e: any) {
        fila.estado = 'ERROR'; fila.detalle = e?.message || String(e);
        nuevoLog.push(fila); this.log.set([...nuevoLog]);
        if (e instanceof WoApiError && (e.status === 401 || e.status === 403)) { detenido = `World Office rechazó el token (${e.status}). Se detuvo el envío.`; break; }
        if (e instanceof WoApiError && e.duplicadoCheck) { detenido = e.message; break; }
        continue;
      }
      nuevoLog.push(fila); this.log.set([...nuevoLog]);
    }
    const ok = nuevoLog.filter((l) => /CREADO|SIMULADO/.test(l.estado)).length;
    return { ok, total: docs.length, detenido };
  }

  // ---------------- PLANTILLA EXCEL (respaldo manual, mismo formato de la plantilla WO) ----------------
  async descargarPlantilla(): Promise<void> {
    const p = this.prep(); if (!p) return;
    const wb = new ExcelJS.Workbook();
    const fecha = (s: unknown) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : s; };
    const hoja = (nombre: string, headers: string[]) => { const ws = wb.addWorksheet(nombre); ws.addRow(headers).font = { bold: true }; return ws; };

    const enc = hoja('Encabezados', ['Empresa *', 'Prefijo', 'Número de Documento *', 'Fecha *', 'Vendedor *', 'Cliente *', 'Concepto *', 'Forma de Pago *', 'Fecha de Vencimiento *', 'Fecha de Entrega', 'Verificado', 'Anulado', 'Dirección Sucursal', 'Clasificación', 'Contacto', 'Exportación']);
    const mov = hoja('Movimientos de Inventarios', ['Empresa *', 'Prefijo', 'Número de Documento *', 'Producto *', 'Bodega *', 'Unidad de Medida *', 'Cantidad *', 'IVA *', 'Valor Unitario *', 'Descuento *', 'Nota', 'Centro costos', 'Meses a Diferir', 'ImpoConsumo-Advalorem', 'ImpoConsumo-Bolsas', 'ImpoConsumo-Distrital', 'ImpoConsumo-Nacional', 'Impuesto Nacional a la Gasolina y ACPM', 'ImpoConsumo-Advalorem- Porcentaje', 'ImpSaludable Alimentos Ultraprocesados', 'ImpSaludable Bebidas Azucaradas', 'Tercero del Detalle']);
    const pag = hoja('Detalles del Pago', ['Empresa *', 'Prefijo', 'Número de Documento *', 'Forma de Pago *', ' Valor *', 'Banco / Entidad', 'Número Transacción ', 'Franquicia', 'Fecha']);
    p.facturas.forEach((f) => {
      const r = enc.addRow([f.empresa, f.prefijo, f.numero, fecha(f.fecha), Number(WO_CONFIG.vendedorIdentificacion), Number(f.cliente) || f.cliente,
        f.concepto, f.formaPagoWO, fecha(f.fecha), null, 'SI', f.anulado ? 'SI' : 'NO']);
      r.getCell(4).numFmt = 'dd/mm/yyyy'; r.getCell(9).numFmt = 'dd/mm/yyyy';
      const m = mov.addRow([f.empresa, f.prefijo, f.numero, f.producto, WO_CONFIG.bodega, WO_CONFIG.unidadMedida, f.cantidad, 0, f.valorUnitario, 0, f.concepto, f.centroCosto]);
      m.getCell(4).numFmt = '@'; m.getCell(4).value = String(f.producto);
      f.pagos.forEach((pg) => pag.addRow([f.empresa, f.prefijo, f.numero, pg.forma, pg.valor]));
    });

    const rc = hoja('Recibos (RC)', ['Empresa', 'Prefijo', 'Número', 'Fecha', 'Tercero', 'Clase', 'Concepto', 'Cuenta', 'Débito', 'Crédito', 'Centro costos', 'Anulado']);
    p.recibos.forEach((r) => r.asientos.forEach((a) => {
      const row = rc.addRow([r.empresa, r.prefijo, r.numero, fecha(r.fecha), Number(r.cliente) || r.cliente, r.clase, r.concepto,
        Number(a.cuenta), a.naturaleza === 'D' ? a.valor : 0, a.naturaleza === 'C' ? a.valor : 0, r.centroCosto || '', r.anulado ? 'SI' : 'NO']);
      row.getCell(4).numFmt = 'dd/mm/yyyy';
    }));

    const ctl = hoja('CONTROL', ['Control', 'Resultado', 'Detalle']);
    p.controles.forEach((c) => ctl.addRow([c.control, c.ok ? 'OK' : 'REVISAR', c.detalle]));
    ctl.addRow([]); ctl.addRow(['Cuadre por empresa y forma de pago (facturas)', 'Valor']).font = { bold: true };
    Object.entries(p.porEmpresaForma).sort().forEach(([k, v]) => ctl.addRow([k, v]));
    ctl.addRow([]); ctl.addRow(['Excluidos', 'Valor', 'Motivo']).font = { bold: true };
    p.excluidos.forEach((x) => ctl.addRow([x.documento, x.valor, x.motivo]));
    ctl.addRow([]); ctl.addRow(['Excepciones', 'Valor', 'Motivo']).font = { bold: true };
    p.excepciones.forEach((x) => ctl.addRow([x.documento, x.valor, x.motivo]));
    ctl.columns = [{ width: 58 }, { width: 16 }, { width: 90 }];

    const dia = (p.facturas[0] || p.recibos[0] || ({} as any)).fecha || new Date().toISOString().slice(0, 10);
    const buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/octet-stream' }), `PLANTILLA_WO_${dia}.xlsx`);
  }

  async descargarBitacora(): Promise<void> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Bitácora');
    ws.addRow(['Documento', 'Tipo', 'Valor', 'Estado', 'ID World Office', 'Número WO', 'Detalle', 'Payload enviado']).font = { bold: true };
    this.log().forEach((l) => ws.addRow([l.documento, l.tipo, l.valor, l.estado, l.idWO, l.numeroWO, l.detalle, l.payload ? JSON.stringify(l.payload) : '']));
    ws.columns = [{ width: 16 }, { width: 6 }, { width: 12 }, { width: 20 }, { width: 14 }, { width: 12 }, { width: 70 }, { width: 80 }];
    const buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/octet-stream' }), `Bitacora_WorldOffice_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`);
  }
}
