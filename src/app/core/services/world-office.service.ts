import { Injectable, signal } from '@angular/core';
import ExcelJS from 'exceljs';
import { normId } from '../utils/normalizacion.util';
import { encontrarArrayObjetos } from '../utils/json.util';
import { key } from '../utils/world-office.util';
import { descargar } from '../utils/descargar.util';
import { llenarPlantillaFactura, llenarPlantillaRecibo, RUTA_PLANTILLA_FACTURA, RUTA_PLANTILLA_RECIBO } from '../utils/world-office-plantillas.util';
import {
  CatalogosWO, EntidadCatalogo, EstadoServidorWO, FacturaWO, FilaBitacora, OpcionesEnvio, PreparacionWO, ReciboWO, RegistroHistorialWO, WO_CONFIG,
} from '../models/world-office.model';

/** Error del backend /api/worldoffice (o de World Office a través de él): incluye el status HTTP y el JSON crudo. */
export class WoApiError extends Error {
  constructor(message: string, readonly status: number, readonly json: any = null, readonly duplicadoCheck = false) {
    super(message);
  }
}

type DocumentoWO = FacturaWO | ReciboWO;

/**
 * El token de World Office YA NO pasa por el navegador: vive en la variable de
 * entorno WO_API_TOKEN del backend (api/worldoffice.js), que es quien habla con
 * api.worldoffice.cloud. La página solo envía la clave de acceso de la app
 * (APP_ACCESS_KEY), que se guarda en sessionStorage: se olvida al cerrar la
 * pestaña o con «Cerrar sesión de World Office».
 */
const SS_CLAVE = 'rehabilitar_wo_clave_v1';
/** Historial de respaldo en este navegador cuando el servidor no tiene historial compartido (KV). No guarda secretos. */
const LS_HISTORIAL = 'rehabilitar_wo_historial_v1';

function leerClave(): string { try { return sessionStorage.getItem(SS_CLAVE) || ''; } catch { return ''; } }
function guardarClave(c: string): void { try { sessionStorage.setItem(SS_CLAVE, c); } catch { /* sin sessionStorage: se pide cada vez */ } }
function borrarClave(): void { try { sessionStorage.removeItem(SS_CLAVE); } catch { /* nada que borrar */ } }

/**
 * Cliente del backend /api/worldoffice + orquestador de
 * «preparar → plantillas → conectar → simular/enviar → historial».
 */
@Injectable({ providedIn: 'root' })
export class WorldOfficeService {
  readonly claveApp = signal(leerClave());
  readonly estadoServidor = signal<EstadoServidorWO | null>(null);
  readonly cat = signal<CatalogosWO | null>(null);
  readonly prep = signal<PreparacionWO | null>(null);
  readonly log = signal<FilaBitacora[]>([]);
  readonly historial = signal<RegistroHistorialWO[]>([]);
  readonly historialPersistente = signal(false);
  private cache: { terceros: Record<string, EntidadCatalogo | null>; inventarios: Record<string, EntidadCatalogo | null>; cuentas: Record<string, EntidadCatalogo | null> } =
    { terceros: {}, inventarios: {}, cuentas: {} };

  // ---------------- BACKEND ----------------
  private async backend(cuerpo: unknown, metodoHttp: 'GET' | 'POST' = 'POST', query = ''): Promise<any> {
    const resp = await fetch(WO_CONFIG.apiBase + query, {
      method: metodoHttp,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-rehabilitar-clave': this.claveApp() },
      body: metodoHttp === 'GET' ? undefined : JSON.stringify(cuerpo),
    });
    const raw = await resp.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* respuesta no-JSON, se maneja abajo */ }
    if (!resp.ok) {
      const msg = (json && (json.error || json.userMessage || json.detail)) || raw.slice(0, 300) || resp.statusText;
      throw new WoApiError(msg, resp.status, json);
    }
    if (json === null) throw new WoApiError('El servidor no respondió JSON: ¿está desplegado api/worldoffice.js?', resp.status);
    return json;
  }
  /** Lecturas a World Office (listar*, consultas por código/ID) a través del backend. */
  private woFetch(method: 'GET' | 'POST', ruta: string, body?: unknown): Promise<any> {
    return this.backend({ accion: 'consultar', metodo: method, ruta, cuerpo: body });
  }
  /** Escrituras a World Office (crear/contabilizar/anular). `clave` activa el control de duplicados y el historial del servidor. */
  private woEscribir(ruta: string, body: unknown, clave: string, meta: Record<string, unknown>): Promise<any> {
    return this.backend({ accion: 'enviar', metodo: 'POST', ruta, cuerpo: body, clave, meta });
  }

  async consultarEstado(): Promise<void> {
    try { this.estadoServidor.set(await this.backend(null, 'GET', '?accion=estado')); }
    catch { this.estadoServidor.set(null); }
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

  async cargarCatalogos(): Promise<CatalogosWO> {
    const cat: CatalogosWO = { empresas: {}, prefijos: { FV: {}, RC: {} }, formasVenta: {}, formasContables: {}, monedas: {}, bodegas: {}, centros: {}, errores: [] };
    const intento = async (nombre: string, fn: () => Promise<void>) => {
      try { await fn(); } catch (e) {
        cat.errores.push(nombre + ': ' + (e instanceof Error ? e.message : String(e)));
        if (e instanceof WoApiError && (e.status === 401 || e.status === 503)) throw e;
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

  async conectar(clave: string): Promise<{ ok: boolean; mensaje: string }> {
    this.claveApp.set(clave.trim());
    if (!this.claveApp()) return { ok: false, mensaje: 'Escribe la clave de acceso de la aplicación.' };
    this.cache = { terceros: {}, inventarios: {}, cuentas: {} };
    try {
      const cat = await this.cargarCatalogos();
      this.cat.set(cat);
      guardarClave(this.claveApp());
      void this.cargarHistorial();
      return { ok: true, mensaje: `Conectado. ${Object.keys(cat.empresas).length} empresa(s), ${Object.keys(cat.prefijos.FV).length} prefijo(s) FV, ${Object.keys(cat.prefijos.RC).length} prefijo(s) RC.` };
    } catch (e) {
      this.cat.set(null);
      if (e instanceof WoApiError) {
        if (e.status === 401) { borrarClave(); return { ok: false, mensaje: 'Clave de la aplicación incorrecta, o World Office rechazó el token configurado en el servidor.' }; }
        if (e.status === 503) return { ok: false, mensaje: 'Falta configurar el servidor: ' + e.message };
        if (e.status === 404 || e.status === 405) return { ok: false, mensaje: 'No responde /api/worldoffice: revisa que api/worldoffice.js esté desplegado (en local: npm run wo:dev).' };
      }
      return { ok: false, mensaje: 'No se pudo conectar: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  /** Olvida la clave de la app en esta pestaña y desconecta. */
  cerrarSesion(): void {
    borrarClave();
    this.claveApp.set('');
    this.cat.set(null);
    this.log.set([]);
    this.cache = { terceros: {}, inventarios: {}, cuentas: {} };
  }

  // ---------------- ARMADO DE PAYLOADS (JSON de la API, equivalente a las plantillas) ----------------
  async armarFactura(f: FacturaWO, conservarNumero: boolean): Promise<{ payload?: any; falta?: string[] }> {
    const cat = this.cat(); if (!cat) return { falta: ['sin catálogos: conecta primero'] };
    const falta: string[] = [];
    const empresa = cat.empresas[key(f.empresa)]; if (!empresa) falta.push('empresa «' + f.empresa.trim() + '»');
    const pref = cat.prefijos.FV[key(f.prefijoWO)]; if (!pref) falta.push('prefijo FV «' + f.prefijoWO + '»');
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
      // Trazabilidad: el documento de Medifolios queda en los campos «externos» de World Office.
      prefijoExterno: f.prefijo, numeroExterno: String(f.numero),
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
    const pref = cat.prefijos.RC[key(r.prefijoWO)]; if (!pref) falta.push('prefijo RC «' + r.prefijoWO + '»');
    const ter = await this.tercero(r.cliente); if (!ter) falta.push('tercero ' + r.cliente + ' (crearlo en WO)');
    const centro = r.centroCosto ? cat.centros[key(r.centroCosto)] : null;
    if (r.centroCosto && !centro) falta.push('centro de costos «' + r.centroCosto + '»');
    const asientos: any[] = [];
    for (const a of r.asientos) {
      const cta = await this.cuenta(a.cuenta);
      if (!cta) { falta.push('cuenta contable ' + a.cuenta); continue; }
      const as: any = {
        cuentaContableId: cta.id, concepto: r.concepto, terceroId: ter ? ter.id : null,
        valorDebito: a.naturaleza === 'D' ? a.valor : 0, valorCredito: a.naturaleza === 'C' ? a.valor : 0, fechaVencimiento: r.fecha,
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

  /**
   * ¿El documento ya está en World Office? Facturas: mismo prefijo y número.
   * Recibos: el documento de Medifolios va dentro del concepto («ANTICIPO ANTR-1995»).
   */
  private async buscarExistente(d: DocumentoWO): Promise<EntidadCatalogo | null> {
    const filtroTipo = { atributo: 'documentoTipo.codigoDocumento', valor: d.tipo, valor2: null, tipoFiltro: 0, tipoDato: 0, nombreColumna: null, valores: null, clase: null, operador: 0, subGrupo: 'filtro' };
    const base = { columnaOrdenar: 'id', pagina: 0, registrosPorPagina: 20, orden: 'DESC', canal: 0, registroInicial: 0 };
    if (d.tipo === 'FV') {
      const json = await this.woFetch('POST', '/documentos/listarDocumentoVenta', { ...base, filtros: [filtroTipo,
        { atributo: 'numero', valor: String(d.numero), valor2: null, tipoFiltro: 0, tipoDato: 4, nombreColumna: null, valores: null, clase: null, operador: 0, subGrupo: 'filtro' }] });
      const pre = key(d.prefijoWO);
      return (this.lista(json) as any[]).find((x) => Number(x.numero) === d.numero
        && key(typeof x.prefijo === 'object' && x.prefijo ? x.prefijo.nombre : x.prefijo) === pre
        && (!x.empresa || key(typeof x.empresa === 'object' ? x.empresa.nombre : x.empresa) === key(d.empresa))) || null;
    }
    const json = await this.woFetch('POST', '/contabilidad/listarDocContable', { ...base, filtros: [filtroTipo,
      { atributo: 'concepto', valor: d.documento, valor2: null, tipoFiltro: 1, tipoDato: 0, nombreColumna: null, valores: null, clase: null, operador: 0, subGrupo: 'filtro' }] });
    return (this.lista(json) as any[]).find((x) => String(x.concepto || '').toUpperCase().split(/\s+/).includes(d.documento.toUpperCase())) || null;
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
    const agregar = (f: FilaBitacora) => { nuevoLog.push(f); this.log.set([...nuevoLog]); };
    let detenido: string | null = null;
    // Lo que el historial del servidor ya registra como creado no se vuelve a enviar.
    let previos: Record<string, RegistroHistorialWO> = {};
    try { previos = (await this.backend({ accion: 'claves', claves: docs.map((d) => d.clave) })).registros || {}; } catch { /* sin historial compartido */ }
    let i = 0;
    for (const d of docs) {
      i++; onProgreso?.(i, docs.length, d.documento);
      const fila: FilaBitacora = { documento: d.documento, tipo: d.tipo, valor: d.valor, estado: '', idWO: '', numeroWO: '', detalle: '', payload: null };
      try {
        if (!d.envioAPI) { fila.estado = 'SOLO PLANTILLA'; fila.detalle = d.avisos.join(' · ') || 'Se carga con la plantilla Excel'; agregar(fila); continue; }
        const prev = previos[d.clave];
        if (prev && prev.creado) { fila.estado = 'YA ENVIADO'; fila.idWO = prev.idWO ?? ''; fila.detalle = `Enviado el ${String(prev.fecha).slice(0, 16).replace('T', ' ')} (historial)`; agregar(fila); continue; }
        const { payload, falta } = d.tipo === 'FV' ? await this.armarFactura(d, opciones.conservarNumero) : await this.armarRecibo(d);
        if (falta) { fila.estado = 'FALTA EN WO'; fila.detalle = 'No existe en World Office: ' + falta.join('; '); agregar(fila); continue; }
        fila.payload = payload;
        if (opciones.verificarDuplicados) {
          const ex = await this.yaExiste(d);
          if (ex) { fila.estado = 'YA EXISTE'; fila.idWO = ex.id; fila.detalle = 'Ya estaba en World Office: no se reenvió'; agregar(fila); continue; }
        }
        if (simular) { fila.estado = 'SIMULADO'; fila.detalle = 'Validado contra World Office; no se envió (simulación)'; agregar(fila); continue; }

        const meta = { documento: d.documento, tipo: d.tipo, valor: d.valor, fecha: d.fecha, empresa: d.empresaKey, cliente: d.cliente };
        const resp = await this.woEscribir(d.tipo === 'FV' ? '/documentos/crearDocumentoVenta' : '/contabilidad/crearDocContable', payload, d.clave, meta);
        const data = (resp && resp.data) || {};
        fila.idWO = data.id || ''; fila.numeroWO = data.numero || '';
        const notas: string[] = [];
        if (d.tipo === 'FV' && opciones.conservarNumero && fila.numeroWO && Number(fila.numeroWO) !== d.numero) notas.push(`OJO: WO asignó el número ${fila.numeroWO} y no ${d.numero}`);
        if (d.tipo === 'RC') notas.push(`recibo ${d.documento} quedó con el consecutivo WO ${fila.numeroWO || '(sin número)'}`);
        if (d.tipo === 'FV' && opciones.contabilizar && fila.idWO) {
          try { await this.woEscribir('/documentos/contabilizarDocumento/' + fila.idWO, null, d.clave + '#contabilizar', meta); notas.push('contabilizada'); }
          catch (e) { notas.push('creada pero NO contabilizada: ' + (e instanceof Error ? e.message : String(e))); }
        }
        if (d.anulado && fila.idWO) {
          try { await this.woEscribir((d.tipo === 'FV' ? '/documentos/anularDocumento/' : '/contabilidad/anularDocumento/') + fila.idWO, null, d.clave + '#anular', meta); notas.push('anulada'); }
          catch (e) { notas.push('creada pero NO anulada: ' + (e instanceof Error ? e.message : String(e))); }
        }
        fila.estado = notas.some((n) => /NO |OJO/.test(n)) ? 'CREADO CON NOVEDAD' : 'CREADO';
        fila.detalle = (resp && resp.userMessage ? resp.userMessage + ' · ' : '') + notas.join(' · ');
      } catch (e: any) {
        // 409 = el backend detectó que ese documento ya se había enviado (o se está enviando en otra sesión).
        fila.estado = e instanceof WoApiError && e.status === 409 ? 'YA ENVIADO' : 'ERROR';
        fila.detalle = e?.message || String(e);
        agregar(fila);
        if (e instanceof WoApiError && (e.status === 401 || e.status === 503)) { detenido = `El servidor rechazó la operación (${e.status}): ${e.message}. Se detuvo el envío.`; break; }
        if (e instanceof WoApiError && e.duplicadoCheck) { detenido = e.message; break; }
        continue;
      }
      agregar(fila);
    }
    if (!simular) { this.guardarHistorialLocal(nuevoLog); await this.cargarHistorial(); }
    const ok = nuevoLog.filter((l) => /CREADO|SIMULADO/.test(l.estado)).length;
    return { ok, total: docs.length, detenido };
  }

  // ---------------- HISTORIAL ----------------
  async cargarHistorial(): Promise<void> {
    try {
      if (this.claveApp()) {
        const h = await this.backend(null, 'GET', '?accion=historial&limite=500');
        if (h.persistente) { this.historialPersistente.set(true); this.historial.set(h.items || []); return; }
      }
    } catch { /* sin servidor o sin clave: historial local */ }
    this.historialPersistente.set(false);
    try { this.historial.set(JSON.parse(localStorage.getItem(LS_HISTORIAL) || '[]')); } catch { this.historial.set([]); }
  }

  private guardarHistorialLocal(filas: FilaBitacora[]): void {
    try {
      const prev: RegistroHistorialWO[] = JSON.parse(localStorage.getItem(LS_HISTORIAL) || '[]');
      const nuevos: RegistroHistorialWO[] = filas.filter((f) => !/SIMULADO|SOLO PLANTILLA/.test(f.estado)).map((f) => ({
        fecha: new Date().toISOString(), clave: '', ruta: f.tipo === 'FV' ? '/documentos/crearDocumentoVenta' : '/contabilidad/crearDocContable',
        ok: /CREADO/.test(f.estado), creado: /CREADO/.test(f.estado), idWO: f.idWO || null, numeroWO: f.numeroWO || null,
        mensaje: `${f.estado}: ${f.detalle}`, meta: { documento: f.documento, valor: f.valor },
      }));
      localStorage.setItem(LS_HISTORIAL, JSON.stringify([...nuevos, ...prev].slice(0, 2000)));
    } catch { /* localStorage no disponible */ }
  }

  // ---------------- PLANTILLAS OFICIALES Y BITÁCORAS ----------------
  /** Descarga las plantillas OFICIALES de World Office llenas con los documentos preparados. */
  async descargarPlantillas(docs?: { facturas: FacturaWO[]; recibos: ReciboWO[] }): Promise<void> {
    const p = docs || this.prep(); if (!p) return;
    const leer = async (ruta: string) => {
      const r = await fetch(ruta);
      if (!r.ok) throw new Error(`No se encontró la plantilla oficial ${ruta}`);
      return r.arrayBuffer();
    };
    const dia = (p.facturas[0] || p.recibos[0] || ({} as any)).fecha || new Date().toISOString().slice(0, 10);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (p.facturas.length) {
      const buf = await llenarPlantillaFactura(await leer(RUTA_PLANTILLA_FACTURA), p.facturas);
      descargar(new Blob([buf], { type: xlsx }), `PlantillaFacturaVenta_WO_${dia}.xlsx`);
    }
    if (p.recibos.length) {
      const buf = await llenarPlantillaRecibo(await leer(RUTA_PLANTILLA_RECIBO), p.recibos);
      descargar(new Blob([buf], { type: xlsx }), `PlantillaRecibosDeCaja_WO_${dia}.xlsx`);
    }
  }

  async descargarBitacora(): Promise<void> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Bitácora');
    ws.addRow(['Documento', 'Tipo', 'Valor', 'Estado', 'ID World Office', 'Número WO', 'Detalle', 'Payload enviado']).font = { bold: true };
    this.log().forEach((l) => ws.addRow([l.documento, l.tipo, l.valor, l.estado, l.idWO, l.numeroWO, l.detalle, l.payload ? JSON.stringify(l.payload) : '']));
    ws.columns = [{ width: 16 }, { width: 6 }, { width: 12 }, { width: 20 }, { width: 14 }, { width: 12 }, { width: 70 }, { width: 80 }];
    const buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/octet-stream' }), `Bitacora_WorldOffice_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`);
  }

  async descargarHistorial(): Promise<void> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Historial World Office');
    ws.addRow(['Fecha', 'Documento', 'Clave', 'Operación', 'Resultado', 'ID World Office', 'Número WO', 'Mensaje']).font = { bold: true };
    this.historial().forEach((h) => ws.addRow([String(h.fecha || '').replace('T', ' ').slice(0, 19), h.meta?.documento ?? '', h.clave, operacionDe(h.ruta),
      h.ok ? 'OK' : 'ERROR', h.idWO ?? '', h.numeroWO ?? '', h.mensaje]));
    ws.columns = [{ width: 20 }, { width: 16 }, { width: 26 }, { width: 16 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 80 }];
    const buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/octet-stream' }), `Historial_WorldOffice_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
}

/** Nombre legible de la operación registrada en el historial. */
export function operacionDe(ruta: string): string {
  if (/crearDocumentoVenta/.test(ruta)) return 'Crear factura';
  if (/crearDocContable/.test(ruta)) return 'Crear recibo';
  if (/contabilizar/.test(ruta)) return 'Contabilizar';
  if (/anular/.test(ruta)) return 'Anular';
  if (/cruzar/.test(ruta)) return 'Cruzar';
  return ruta;
}
