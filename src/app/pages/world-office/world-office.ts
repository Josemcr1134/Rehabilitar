import { JsonPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { fechaLocal, operacionDe, WorldOfficeService } from '../../core/services/world-office.service';
import { CENTROS, FacturaWO, ReciboWO, TABLA_A, WO_CONFIG } from '../../core/models/world-office.model';
import { fmtCOP, key, prepararDocumentos } from '../../core/utils/world-office.util';
import { TerceroNuevo, TIPOS_IDENTIFICACION, validarTercero } from '../../core/utils/world-office-terceros.util';

type DocumentoWO = FacturaWO | ReciboWO;

/**
 * «World Office · Facturas (FV) y recibos (RC) desde Caja» — CLAUDE.md sección 15.
 * Migrada 1:1 desde el bloque <script> final de index.html (montarTarjeta() + ui.*).
 * Toma state.data.CAJA tal cual esté cargado (API o Excel); no depende de haber
 * conciliado antes.
 */
@Component({
  selector: 'app-world-office',
  imports: [FormsModule, JsonPipe],
  templateUrl: './world-office.html',
  styleUrl: './world-office.css',
})
export class WorldOffice {
  readonly appState = inject(AppStateService);
  readonly wo = inject(WorldOfficeService);
  readonly fmtCOP = fmtCOP;

  /** Clave de acceso de la aplicación (APP_ACCESS_KEY). El token de World Office NO pasa por el navegador. */
  clave = '';
  /** true si la clave se recordó de esta misma pestaña (sessionStorage). */
  readonly sesionRecordada = signal(false);
  readonly operacionDe = operacionDe;
  readonly fechaLocal = fechaLocal;

  readonly conservarNumero = signal(true);
  readonly contabilizar = signal(true);
  readonly verificarDuplicados = signal(true);
  readonly basico = signal(false);
  readonly verExcluidos = signal(false);

  readonly mensaje = signal('');
  readonly bloqueado = signal(false);
  readonly deseleccionados = signal<Set<string>>(new Set());

  readonly caja = computed(() => this.appState.caja());
  readonly prep = this.wo.prep;
  readonly cat = this.wo.cat;
  readonly log = this.wo.log;
  readonly estadoServidor = this.wo.estadoServidor;
  readonly historial = this.wo.historial;
  readonly historialPersistente = this.wo.historialPersistente;
  readonly pacientesNuevos = this.wo.pacientesNuevos;
  readonly ciudadesWO = this.wo.ciudadesWO;
  readonly archivosCabecera = this.wo.archivosCabecera;
  readonly contactosCabecera = this.wo.contactosCabecera;
  readonly tiposIdentificacion = TIPOS_IDENTIFICACION;
  /** Ciudad que se copia a todos los pacientes nuevos con «Aplicar a todos». */
  ciudadTodos = '';

  readonly cajaInfo = computed(() => {
    const caja = this.caja();
    return caja ? `Caja cargada: ${caja.length} movimientos (${this.appState.origen().CAJA || 'API'}).` : 'Carga primero el reporte de CAJA (opción A o B).';
  });

  readonly puedeConectar = computed(() => !this.bloqueado());
  readonly puedePreparar = computed(() => !this.bloqueado() && !!(this.caja() && this.caja()!.length));
  readonly puedeExcel = computed(() => !this.bloqueado() && !!this.prep());
  readonly puedeApi = computed(() => !this.bloqueado() && !!this.prep() && !!this.cat());

  readonly sumFacturas = computed(() => fmtCOP((this.prep()?.facturas || []).reduce((s, x) => s + x.valor, 0)));
  readonly sumRecibos = computed(() => fmtCOP((this.prep()?.recibos || []).reduce((s, x) => s + x.valor, 0)));
  readonly sumExcluidos = computed(() => fmtCOP((this.prep()?.excluidos || []).reduce((s, x) => s + x.valor, 0)));
  readonly sumExcepciones = computed(() => fmtCOP((this.prep()?.excepciones || []).reduce((s, x) => s + x.valor, 0)));

  /** Documentos que solo se cargan con la plantilla Excel (p. ej. abonos a deuda mientras recibosDeudaPorAPI = false). */
  readonly soloPlantilla = computed(() => this.docsVisibles().filter((d) => !d.envioAPI).length);

  readonly docsVisibles = computed<DocumentoWO[]>(() => {
    const p = this.prep();
    return p ? [...p.facturas, ...p.recibos] : [];
  });

  readonly catalogoFilas = computed(() => {
    const c = this.cat();
    if (!c) return [];
    const filas: Array<[string, string, boolean]> = [];
    Object.values(WO_CONFIG.empresas).forEach((n) => filas.push(['Empresa', n.trim(), !!c.empresas[key(n)]]));
    const prefFV = new Set(WO_CONFIG.prefijosFactura.map((p) => WO_CONFIG.prefijoWO[p] || p));
    const prefRC = new Set([...WO_CONFIG.prefijosReciboAnticipo, ...WO_CONFIG.prefijosReciboDeuda].map((p) => WO_CONFIG.prefijoWO[p] || p));
    prefFV.forEach((p) => filas.push(['Prefijo FV', p, !!c.prefijos.FV[key(p)]]));
    prefRC.forEach((p) => filas.push(['Prefijo RC', p, !!c.prefijos.RC[key(p)]]));
    [...new Set(Object.values(TABLA_A).map((t) => t.forma))].forEach((f) => filas.push(['Forma de pago', f, !!c.formasVenta[key(f)]]));
    filas.push(['Moneda', WO_CONFIG.monedaCodigo, !!c.monedas[key(WO_CONFIG.monedaCodigo)]]);
    filas.push(['Bodega', WO_CONFIG.bodega, !!c.bodegas[key(WO_CONFIG.bodega)]]);
    [...new Set(CENTROS.map((x) => x[1]))].forEach((n) => filas.push(['Centro de costos', n, !!c.centros[key(n)]]));
    return filas;
  });

  constructor() {
    void this.wo.consultarEstado();
    void this.wo.cargarHistorial();
    const guardada = this.wo.claveApp();
    if (guardada && !this.wo.cat()) {
      this.clave = guardada;
      this.sesionRecordada.set(true);
      void this.conectar();
    }
  }

  preparar() {
    const p = prepararDocumentos(this.caja() || []);
    this.wo.prep.set(p);
    this.wo.pacientesNuevos.set(null);
    this.deseleccionados.set(new Set());
    this.mensaje.set(`Listo: ${p.facturas.length} facturas y ${p.recibos.length} recibos. ${this.cat() ? 'Puedes simular.' : 'Conecta con World Office para simular o enviar.'}`);
  }

  async conectar() {
    this.bloqueado.set(true);
    this.mensaje.set('Leyendo catálogos de World Office…');
    const r = await this.wo.conectar(this.clave);
    this.mensaje.set(r.mensaje);
    this.bloqueado.set(false);
    if (!r.ok) this.sesionRecordada.set(false);
  }

  /** Olvida la clave de la app en esta pestaña — para cuando el equipo se comparte. */
  cerrarSesionWO() {
    this.wo.cerrarSesion();
    this.clave = '';
    this.ciudadTodos = '';
    this.sesionRecordada.set(false);
    this.deseleccionados.set(new Set());
    this.mensaje.set('Sesión de World Office cerrada en este navegador.');
  }

  // ---------- Pacientes nuevos (terceros) ----------
  async revisarPacientes(): Promise<TerceroNuevo[] | null> {
    if (!this.cat()) { this.mensaje.set('Primero conecta con World Office.'); return null; }
    const docs = this.docsSeleccionados();
    if (!docs.length) { this.mensaje.set('No hay documentos seleccionados.'); return null; }
    this.bloqueado.set(true);
    try {
      const nuevos = await this.wo.detectarPacientesNuevos(docs, (i, tot) => this.mensaje.set(`Buscando pacientes en World Office ${i} de ${tot}…`));
      this.mensaje.set(nuevos.length
        ? `${nuevos.length} paciente(s) nuevo(s) no existen en World Office: completa sus datos abajo y descarga la plantilla de terceros.`
        : 'Todos los pacientes ya existen en World Office.');
      return nuevos;
    } catch (e) {
      this.mensaje.set('No se pudieron revisar los pacientes: ' + (e instanceof Error ? e.message : String(e)));
      return null;
    } finally {
      this.bloqueado.set(false);
    }
  }

  /** Carga uno o varios «Reporte Cabecera Facturación» de Medifolios (dirección, teléfono y correo de los pacientes). */
  async onCabecera(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    for (const f of archivos) {
      try {
        const info = await this.wo.cargarCabecera(f);
        this.mensaje.set(`Cabecera «${info.nombre}» cargada: ${info.pacientes} paciente(s) con datos de contacto`
          + (info.periodo ? ` (periodo ${info.periodo})` : '') + '.');
      } catch (e) {
        this.mensaje.set(`No se pudo leer «${f.name}»: ` + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
  }

  limpiarCabecera() {
    this.wo.limpiarCabecera();
    this.mensaje.set('Se quitaron los datos de la cabecera de facturación (lo ya copiado a los pacientes nuevos se conserva).');
  }

  erroresPaciente(t: TerceroNuevo): string[] { return validarTercero(t, this.ciudadesWO()); }

  pacientesCompletos(): TerceroNuevo[] { return (this.pacientesNuevos() || []).filter((t) => !this.erroresPaciente(t).length); }

  aplicarCiudadATodos() {
    const c = this.ciudadTodos.trim();
    if (!c) return;
    (this.pacientesNuevos() || []).forEach((t) => { t.ciudad = c; });
    this.pacientesNuevos.set([...(this.pacientesNuevos() || [])]);
  }

  async descargarPlantillaTerceros() {
    const todos = this.pacientesNuevos() || [];
    const listos = this.pacientesCompletos();
    if (!listos.length) { this.mensaje.set('Ningún paciente nuevo tiene todos los datos obligatorios todavía.'); return; }
    try {
      await this.wo.descargarPlantillaTerceros(listos);
      const faltan = todos.length - listos.length;
      this.mensaje.set(`Plantilla de terceros descargada con ${listos.length} paciente(s).`
        + (faltan ? ` ${faltan} quedaron por fuera porque les faltan datos.` : '')
        + ' Impórtala en World Office y luego vuelve a «Revisar pacientes nuevos».');
    } catch (e) {
      this.mensaje.set('No se pudo generar la plantilla de terceros: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  seleccionado(doc: string): boolean { return !this.deseleccionados().has(doc); }

  toggleSeleccion(doc: string) {
    const s = new Set(this.deseleccionados());
    if (s.has(doc)) s.delete(doc); else s.add(doc);
    this.deseleccionados.set(s);
  }

  private docsSeleccionados(): DocumentoWO[] {
    return this.docsVisibles().filter((d) => this.seleccionado(d.documento));
  }

  async simular() { await this.enviarInterno(true); }

  async enviarReal() {
    const docs = this.docsSeleccionados();
    if (!docs.length) { this.mensaje.set('No hay documentos seleccionados.'); return; }
    // Antes de enviar: ¿hay pacientes que todavía no existen en World Office?
    const nuevos = await this.revisarPacientes();
    if (nuevos === null) return;
    const total = docs.reduce((s, d) => s + d.valor, 0);
    const docsNuevos = nuevos.reduce((n, t) => n + t.documentos.length, 0);
    const txt = `Se van a CREAR en World Office ${docs.filter((d) => d.tipo === 'FV').length} factura(s) y ${docs.filter((d) => d.tipo === 'RC').length} recibo(s) por ${fmtCOP(total)}.\n\n`
      + (nuevos.length ? `OJO: ${nuevos.length} paciente(s) nuevo(s) no existen en World Office; sus ${docsNuevos} documento(s) NO se van a crear hasta que los importes con la plantilla de terceros.\n\n` : '')
      + (this.contabilizar() ? 'Las facturas se contabilizan al crearlas.\n' : 'Las facturas quedan SIN contabilizar.\n')
      + 'Esta acción modifica directamente la información contable. ¿Continuar?';
    if (!confirm(txt)) return;
    await this.enviarInterno(false, true);
  }

  private async enviarInterno(simular: boolean, pacientesRevisados = false) {
    if (!this.prep()) { this.mensaje.set('Primero prepara los documentos.'); return; }
    if (!this.cat()) { this.mensaje.set('Primero conecta con World Office.'); return; }
    const docs = this.docsSeleccionados();
    if (!docs.length) { this.mensaje.set('No hay documentos seleccionados.'); return; }
    if (!pacientesRevisados && (await this.revisarPacientes()) === null) return;
    const nuevos = this.pacientesNuevos()?.length || 0;
    this.bloqueado.set(true);
    this.wo.log.set([]);
    const opciones = { conservarNumero: this.conservarNumero(), contabilizar: this.contabilizar(), verificarDuplicados: this.verificarDuplicados(), basico: this.basico() };
    const { ok, total, detenido } = await this.wo.enviar(simular, docs, opciones, (i, tot, doc) => {
      this.mensaje.set(`${simular ? 'Simulando' : 'Enviando'} ${i} de ${tot}: ${doc}…`);
    });
    this.bloqueado.set(false);
    if (detenido) { this.mensaje.set(detenido); return; }
    this.mensaje.set(`${simular ? 'Simulación terminada' : 'Envío terminado'}: ${ok} de ${total} ${simular ? 'listos' : 'creados'}. Revisa la bitácora.`
      + (nuevos ? ` Hay ${nuevos} paciente(s) nuevo(s): créalos con la plantilla de terceros (sección «Pacientes nuevos»).` : ''));
  }

  async descargarPlantillas() {
    try { await this.wo.descargarPlantillas(); this.mensaje.set('Plantillas oficiales de World Office descargadas.'); }
    catch (e) { this.mensaje.set('No se pudieron generar las plantillas: ' + (e instanceof Error ? e.message : String(e))); }
  }
  descargarBitacora() { void this.wo.descargarBitacora(); }
  descargarHistorial() { void this.wo.descargarHistorial(); }
}
