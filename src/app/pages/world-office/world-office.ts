import { JsonPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { WorldOfficeService } from '../../core/services/world-office.service';
import { CENTROS, FacturaWO, ReciboWO, TABLA_A, WO_CONFIG } from '../../core/models/world-office.model';
import { fmtCOP, key, prepararDocumentos } from '../../core/utils/world-office.util';

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

  token = '';
  authPrefix = WO_CONFIG.authPrefix;

  readonly conservarNumero = signal(true);
  readonly contabilizar = signal(true);
  readonly verificarDuplicados = signal(true);
  readonly verExcluidos = signal(false);

  readonly mensaje = signal('');
  readonly bloqueado = signal(false);
  readonly deseleccionados = signal<Set<string>>(new Set());

  readonly caja = computed(() => this.appState.caja());
  readonly prep = this.wo.prep;
  readonly cat = this.wo.cat;
  readonly log = this.wo.log;

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

  preparar() {
    const p = prepararDocumentos(this.caja() || []);
    this.wo.prep.set(p);
    this.deseleccionados.set(new Set());
    this.mensaje.set(`Listo: ${p.facturas.length} facturas y ${p.recibos.length} recibos. ${this.cat() ? 'Puedes simular.' : 'Conecta con World Office para simular o enviar.'}`);
  }

  async conectar() {
    this.bloqueado.set(true);
    this.mensaje.set('Leyendo catálogos de World Office…');
    const r = await this.wo.conectar(this.token, this.authPrefix);
    this.mensaje.set(r.mensaje);
    this.bloqueado.set(false);
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
    const total = docs.reduce((s, d) => s + d.valor, 0);
    const txt = `Se van a CREAR en World Office ${docs.filter((d) => d.tipo === 'FV').length} factura(s) y ${docs.filter((d) => d.tipo === 'RC').length} recibo(s) por ${fmtCOP(total)}.\n\n`
      + (this.contabilizar() ? 'Las facturas se contabilizan al crearlas.\n' : 'Las facturas quedan SIN contabilizar.\n')
      + 'Esta acción modifica directamente la información contable. ¿Continuar?';
    if (!confirm(txt)) return;
    await this.enviarInterno(false);
  }

  private async enviarInterno(simular: boolean) {
    if (!this.prep()) { this.mensaje.set('Primero prepara los documentos.'); return; }
    if (!this.cat()) { this.mensaje.set('Primero conecta con World Office.'); return; }
    const docs = this.docsSeleccionados();
    if (!docs.length) { this.mensaje.set('No hay documentos seleccionados.'); return; }
    this.bloqueado.set(true);
    this.wo.log.set([]);
    const opciones = { conservarNumero: this.conservarNumero(), contabilizar: this.contabilizar(), verificarDuplicados: this.verificarDuplicados() };
    const { ok, total, detenido } = await this.wo.enviar(simular, docs, opciones, (i, tot, doc) => {
      this.mensaje.set(`${simular ? 'Simulando' : 'Enviando'} ${i} de ${tot}: ${doc}…`);
    });
    this.bloqueado.set(false);
    if (detenido) { this.mensaje.set(detenido); return; }
    this.mensaje.set(`${simular ? 'Simulación terminada' : 'Envío terminado'}: ${ok} de ${total} ${simular ? 'listos' : 'creados'}. Revisa la bitácora.`);
  }

  descargarPlantilla() { this.wo.descargarPlantilla(); }
  descargarBitacora() { this.wo.descargarBitacora(); }
}
