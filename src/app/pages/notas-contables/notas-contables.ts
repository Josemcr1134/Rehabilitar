import { JsonPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { FileLoaderService } from '../../core/services/file-loader.service';
import { WorldOfficeService } from '../../core/services/world-office.service';
import { FileDrop } from '../../shared/components/file-drop/file-drop';
import { fmtCOP } from '../../core/utils/world-office.util';
import { NotaContable, notaCuadrada } from '../../core/utils/world-office-notas.util';
import {
  NOTAS_CONFIG, notasDesdeAgenda, notasDesdeCaja, OmitidaNota, PREFIJOS_AGENDA, PREFIJOS_CAJA, PrefijoNota, siguientesPorDefecto,
} from '../../core/utils/notas-contables.util';
import { DocumentoConTercero, TerceroNuevo, TIPOS_IDENTIFICACION, validarTercero } from '../../core/utils/world-office-terceros.util';

/** La numeración no es dato sensible: se recuerda en este navegador para la próxima vez. */
const LS_NUMEROS = 'rehabilitar_notas_numeros_v1';

type Origen = 'agenda' | 'caja';

interface ResumenPrefijo {
  prefijo: PrefijoNota;
  descripcion: string;
  notas: number;
  lineas: number;
  total: number;
  desde: number;
  hasta: number;
  fechas: string;
  descuadradas: number;
}

/**
 * «Notas contables» para World Office: asume paciente / asume entidad desde la AGENDA
 * (AP, APL, AE, AEL) y sus reversiones desde el DIARIO DE CAJA (APR, APLR), en la
 * plantilla OFICIAL PlantillaNotasDeContabilidad.xlsx. Igual que la pestaña World Office:
 * revisa si hay pacientes nuevos y arma la plantilla de terceros solo si hace falta.
 */
@Component({
  selector: 'app-notas-contables',
  imports: [FormsModule, FileDrop, JsonPipe],
  templateUrl: './notas-contables.html',
  styleUrl: './notas-contables.css',
})
export class NotasContables {
  readonly appState = inject(AppStateService);
  private readonly fileLoader = inject(FileLoaderService);
  readonly wo = inject(WorldOfficeService);
  readonly fmtCOP = fmtCOP;
  readonly descripcion = NOTAS_CONFIG.descripcion;
  readonly prefijosAgenda = PREFIJOS_AGENDA;
  readonly prefijosCaja = PREFIJOS_CAJA;
  readonly tiposIdentificacion = TIPOS_IDENTIFICACION;

  readonly origen = signal<Origen>('agenda');
  readonly mensaje = signal('');
  readonly bloqueado = signal(false);
  readonly estadoArchivo = signal<{ mensaje: string; error: boolean }>({ mensaje: '', error: false });

  /** Rango opcional de fechas (AAAA-MM-DD). Vacío = todo lo que traiga el archivo. */
  desde = '';
  hasta = '';
  /** Siguiente número de cada prefijo (sigue la numeración de las notas ya cargadas en World Office). */
  numeros: Record<PrefijoNota, number> = this.leerNumeros();
  readonly incluir = signal<Set<PrefijoNota>>(new Set([...PREFIJOS_AGENDA, ...PREFIJOS_CAJA]));

  readonly notas = signal<NotaContable[]>([]);
  readonly omitidas = signal<OmitidaNota[]>([]);
  readonly generado = signal(false);
  readonly verDetalle = signal<string>('');

  /** Envío por API: mismas opciones que en la pestaña World Office. */
  readonly conservarNumero = signal(true);
  readonly verificarDuplicados = signal(true);
  readonly logNotas = this.wo.logNotas;

  clave = '';
  ciudadTodos = '';
  readonly cat = this.wo.cat;
  readonly pacientesNuevos = this.wo.pacientesNuevos;
  readonly ciudadesWO = this.wo.ciudadesWO;
  readonly archivosCabecera = this.wo.archivosCabecera;
  readonly contactosCabecera = this.wo.contactosCabecera;
  /** true cuando la revisión de pacientes se hizo sobre las notas que están en pantalla. */
  readonly pacientesRevisados = signal(false);

  readonly agenda = computed(() => this.appState.agenda());
  readonly caja = computed(() => this.appState.caja());
  readonly fuenteInfo = computed(() => {
    if (this.origen() === 'agenda') {
      const a = this.agenda();
      return a ? `Agenda cargada: ${a.length} citas (${this.appState.origen().AGENDA || 'Excel'}).` : 'Todavía no hay agenda cargada: súbela aquí abajo.';
    }
    const c = this.caja();
    return c ? `Diario de caja cargado: ${c.length} movimientos (${this.appState.origen().CAJA || 'Excel'}).` : 'Todavía no hay diario de caja cargado: súbelo aquí abajo.';
  });

  readonly resumen = computed<ResumenPrefijo[]>(() => {
    const porPrefijo = new Map<PrefijoNota, NotaContable[]>();
    for (const n of this.notas()) {
      const p = n.prefijo as PrefijoNota;
      if (!porPrefijo.has(p)) porPrefijo.set(p, []);
      porPrefijo.get(p)!.push(n);
    }
    return [...porPrefijo.entries()].map(([prefijo, ns]) => ({
      prefijo, descripcion: NOTAS_CONFIG.descripcion[prefijo], notas: ns.length,
      lineas: ns.reduce((s, n) => s + n.lineas.length, 0),
      total: ns.reduce((s, n) => s + n.lineas.reduce((t, l) => t + (l.debito || 0), 0), 0),
      desde: ns[0].numero, hasta: ns[ns.length - 1].numero,
      fechas: `${ns[0].fecha} a ${ns[ns.length - 1].fecha}`,
      descuadradas: ns.filter((n) => !notaCuadrada(n)).length,
    }));
  });

  readonly prefijosOrigen = computed(() => (this.origen() === 'agenda' ? PREFIJOS_AGENDA : PREFIJOS_CAJA));

  cambiarOrigen(o: Origen) {
    if (o === this.origen()) return;
    this.origen.set(o);
    this.limpiarResultado();
    this.estadoArchivo.set({ mensaje: '', error: false });
  }

  async onArchivo(file: File) {
    const tipo = this.origen() === 'agenda' ? 'AGENDA' : 'CAJA';
    this.estadoArchivo.set({ mensaje: 'Leyendo archivo…', error: false });
    const r = await this.fileLoader.cargarArchivo(tipo, file);
    this.estadoArchivo.set({ mensaje: r.mensaje, error: !r.ok });
    this.limpiarResultado();
  }

  marcado(p: PrefijoNota): boolean { return this.incluir().has(p); }
  toggle(p: PrefijoNota) {
    const s = new Set(this.incluir());
    if (s.has(p)) s.delete(p); else s.add(p);
    this.incluir.set(s);
  }

  restaurarNumeros() {
    this.numeros = siguientesPorDefecto();
    this.guardarNumeros();
    this.mensaje.set('Numeración restaurada a la de las últimas notas conocidas.');
  }

  generar() {
    const incluir = this.prefijosOrigen().filter((p) => this.marcado(p));
    if (!incluir.length) { this.mensaje.set('Marca al menos un prefijo.'); return; }
    for (const p of incluir) {
      if (!(Number.isInteger(+this.numeros[p]) && +this.numeros[p] > 0)) { this.mensaje.set(`Escribe el número con el que empieza ${p}.`); return; }
    }
    this.guardarNumeros();
    const enRango = (f: string) => (!this.desde || f >= this.desde) && (!this.hasta || f <= this.hasta);
    const siguientes = Object.fromEntries(incluir.map((p) => [p, +this.numeros[p]])) as Partial<Record<PrefijoNota, number>>;
    const r = this.origen() === 'agenda'
      ? notasDesdeAgenda((this.agenda() || []).filter((a) => enRango(a.fecha)), siguientes, incluir)
      : notasDesdeCaja((this.caja() || []).filter((c) => enRango(c.fecha)), siguientes, incluir);
    this.notas.set(r.notas);
    this.omitidas.set(r.omitidas.filter((o) => !o.fecha || enRango(o.fecha)));
    this.generado.set(true);
    this.pacientesRevisados.set(false);
    this.wo.pacientesNuevos.set(null);
    this.mensaje.set(r.notas.length
      ? `Listo: ${r.notas.length} nota(s). Revisa los pacientes nuevos antes de descargar la plantilla.`
      : 'No salió ninguna nota con ese archivo y ese rango de fechas.');
  }

  notasDe(p: PrefijoNota): NotaContable[] { return this.notas().filter((n) => n.prefijo === p); }

  totalNota(n: NotaContable): number { return n.lineas.reduce((s, l) => s + (l.debito || 0), 0); }
  cuadrada(n: NotaContable): boolean { return notaCuadrada(n); }
  claveNota(n: NotaContable): string { return `${n.prefijo}-${n.numero}`; }
  alternarDetalle(n: NotaContable) { this.verDetalle.set(this.verDetalle() === this.claveNota(n) ? '' : this.claveNota(n)); }

  async descargar(r: ResumenPrefijo) {
    const ns = this.notasDe(r.prefijo);
    const nuevos = this.pacientesNuevos()?.length || 0;
    if (!this.pacientesRevisados() && !confirm('Todavía no revisaste si hay pacientes nuevos. Si algún paciente no existe en World Office, la plantilla de notas no carga. ¿Descargar de todas formas?')) return;
    if (this.pacientesRevisados() && nuevos && !confirm(`Hay ${nuevos} paciente(s) que no existen en World Office. Primero importa la plantilla de terceros; si no, World Office rechaza la plantilla de notas. ¿Descargar de todas formas?`)) return;
    try {
      await this.wo.descargarPlantillaNotas(ns, `NC_${r.prefijo}_${r.desde}-${r.hasta}_${ns[0].fecha}_a_${ns[ns.length - 1].fecha}.xlsx`);
      this.mensaje.set(`Plantilla ${r.prefijo} descargada (${r.notas} nota(s), números ${r.desde} a ${r.hasta}). Cuando World Office la acepte, dale «Ya la cargué» para que la próxima empiece en ${r.hasta + 1}.`);
    } catch (e) {
      this.mensaje.set('No se pudo generar la plantilla de notas: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Una sola plantilla de notas con TODO lo generado (todos los prefijos), para revisarla en Excel o cargarla de una vez. */
  async descargarTodo() {
    const ns = this.notas();
    if (!ns.length) { this.mensaje.set('Primero genera las notas.'); return; }
    const tipo = this.origen() === 'agenda' ? 'AsumePaciente_AsumeEntidad' : 'Reversiones';
    try {
      await this.wo.descargarPlantillaNotas(ns, `PlantillaNotasDeContabilidad_${tipo}_${ns.map((n) => n.fecha).sort()[0]}_a_${ns.map((n) => n.fecha).sort().pop()}.xlsx`);
      this.mensaje.set(`Plantilla de notas descargada con las ${ns.length} nota(s) de ${this.resumen().map((r) => r.prefijo).join(', ')}.`);
    } catch (e) {
      this.mensaje.set('No se pudo generar la plantilla de notas: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // ---------- Envío directo a World Office (API) ----------
  readonly puedeEnviar = computed(() => !this.bloqueado() && !!this.cat() && this.notas().length > 0 && this.resumen().every((r) => !r.descuadradas));

  async simular() { await this.enviarInterno(true); }

  async enviarReal() {
    const ns = this.notas();
    if (!ns.length) return;
    await this.revisarPacientes();
    if (!this.pacientesRevisados()) return;
    const nuevos = this.pacientesNuevos()?.length || 0;
    const total = ns.reduce((s, n) => s + this.totalNota(n), 0);
    const txt = `Se van a CREAR en World Office ${ns.length} nota(s) contable(s) (${this.resumen().map((r) => `${r.prefijo} ${r.desde}–${r.hasta}`).join(', ')}) por ${fmtCOP(total)}.

`
      + (nuevos ? `OJO: ${nuevos} paciente(s) no existen en World Office; las notas donde aparecen NO se van a crear hasta que los importes con la plantilla de terceros.

` : '')
      + 'Esta acción modifica directamente la contabilidad. ¿Continuar?';
    if (!confirm(txt)) return;
    await this.enviarInterno(false);
  }

  private async enviarInterno(simular: boolean) {
    if (!this.cat()) { this.mensaje.set('Primero conecta con World Office.'); return; }
    const ns = this.notas();
    if (!ns.length) { this.mensaje.set('Primero genera las notas.'); return; }
    this.bloqueado.set(true);
    const { ok, total, detenido, creadas } = await this.wo.enviarNotas(simular, ns,
      { conservarNumero: this.conservarNumero(), verificarDuplicados: this.verificarDuplicados() },
      (i, tot, doc) => this.mensaje.set(`${simular ? 'Simulando' : 'Enviando'} ${i} de ${tot}: ${doc}…`));
    this.bloqueado.set(false);
    if (!simular) {
      // La numeración sigue después de la última nota creada de cada prefijo.
      for (const n of creadas) {
        const p = n.prefijo as PrefijoNota;
        if (n.numero + 1 > this.numeros[p]) this.numeros[p] = n.numero + 1;
      }
      this.guardarNumeros();
    }
    if (detenido) { this.mensaje.set(detenido); return; }
    this.mensaje.set(`${simular ? 'Simulación terminada' : 'Envío terminado'}: ${ok} de ${total} ${simular ? 'listas' : 'creadas'}. Revisa la bitácora.`);
  }

  descargarBitacora() { void this.wo.descargarBitacoraNotas(); }

  /** Después de cargar la plantilla en World Office: la próxima numeración sigue desde aquí. */
  yaCargada(r: ResumenPrefijo) {
    this.numeros[r.prefijo] = r.hasta + 1;
    this.guardarNumeros();
    this.mensaje.set(`Listo: la próxima nota ${r.prefijo} empieza en ${r.hasta + 1}.`);
  }

  // ---------- World Office: conexión y pacientes nuevos ----------
  async conectar() {
    this.bloqueado.set(true);
    this.mensaje.set('Conectando con World Office…');
    const r = await this.wo.conectar(this.clave || this.wo.claveApp());
    this.mensaje.set(r.mensaje);
    this.bloqueado.set(false);
  }

  async revisarPacientes() {
    if (!this.cat()) { this.mensaje.set('Primero conecta con World Office.'); return; }
    const docs = this.terceros();
    if (!docs.length) { this.mensaje.set('Primero genera las notas.'); return; }
    this.bloqueado.set(true);
    try {
      const nuevos = await this.wo.detectarPacientesNuevos(docs, (i, tot) => this.mensaje.set(`Buscando pacientes en World Office ${i} de ${tot}…`));
      this.pacientesRevisados.set(true);
      this.mensaje.set(nuevos.length
        ? `${nuevos.length} paciente(s) no existen en World Office: completa sus datos abajo, descarga la plantilla de terceros e impórtala antes de las notas.`
        : 'Todos los pacientes ya existen en World Office: no hace falta plantilla de terceros. Ya puedes descargar las notas.');
    } catch (e) {
      this.mensaje.set('No se pudieron revisar los pacientes: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      this.bloqueado.set(false);
    }
  }

  async onCabecera(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    for (const f of archivos) {
      try {
        const info = await this.wo.cargarCabecera(f);
        this.mensaje.set(`Cabecera «${info.nombre}» cargada: ${info.pacientes} paciente(s) con datos de contacto` + (info.periodo ? ` (periodo ${info.periodo})` : '') + '.');
      } catch (e) {
        this.mensaje.set(`No se pudo leer «${f.name}»: ` + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
  }

  limpiarCabecera() {
    this.wo.limpiarCabecera();
    this.mensaje.set('Se quitaron los datos de la cabecera de facturación.');
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
      this.mensaje.set(`Plantilla de terceros descargada con ${listos.length} paciente(s).` + (faltan ? ` ${faltan} quedaron por fuera porque les faltan datos.` : '')
        + ' Impórtala en World Office y luego vuelve a «Revisar pacientes nuevos».');
    } catch (e) {
      this.mensaje.set('No se pudo generar la plantilla de terceros: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Un «documento» por paciente y nota, para reutilizar la revisión de terceros de World Office. */
  private terceros(): DocumentoConTercero[] {
    const out: DocumentoConTercero[] = [];
    const visto = new Set<string>();
    for (const n of this.notas()) {
      for (const l of n.lineas) {
        const k = `${l.tercero}|${n.prefijo}-${n.numero}`;
        if (visto.has(k)) continue;
        visto.add(k);
        out.push({ cliente: l.tercero, nombre: l.nombre || '', documento: `${n.prefijo}-${n.numero}` });
      }
    }
    return out;
  }

  private limpiarResultado() {
    this.notas.set([]);
    this.omitidas.set([]);
    this.generado.set(false);
    this.pacientesRevisados.set(false);
  }

  private leerNumeros(): Record<PrefijoNota, number> {
    const base = siguientesPorDefecto();
    try {
      const guardado = JSON.parse(localStorage.getItem(LS_NUMEROS) || '{}') as Partial<Record<PrefijoNota, number>>;
      for (const p of Object.keys(base) as PrefijoNota[]) if (Number.isInteger(guardado[p]) && guardado[p]! > 0) base[p] = guardado[p]!;
    } catch { /* sin localStorage: se usan los números por defecto */ }
    return base;
  }

  private guardarNumeros() {
    try { localStorage.setItem(LS_NUMEROS, JSON.stringify(this.numeros)); } catch { /* sin localStorage */ }
  }
}
