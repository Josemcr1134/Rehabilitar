import { Injectable, computed, signal } from '@angular/core';
import { AgendaRecord, CajaRecord, ConsumoRecord, TipoFuente } from '../models/records.model';
import { ArchivoCargado } from './excel-import.service';
import { GrupoConciliacion } from '../utils/comparacion.util';
import { OrigenTarifas, ResultadoConciliacion } from '../models/conciliacion-resultado.model';

export type OrigenFuente = 'API' | 'Excel';

/**
 * Reemplaza al objeto global `state` del index.html original. Angular-idiomático:
 * signals en vez de un objeto mutable compartido por referencia. Cada página
 * inyecta este servicio (singleton, providedIn:'root') para leer/escribir el
 * mismo estado — equivalente funcional de `state.data.AGENDA`, `state.token`,
 * `state.groups`, `state.analisisCaja`, etc.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  // --- Datos normalizados por fuente ---
  readonly agenda = signal<AgendaRecord[] | null>(null);
  readonly caja = signal<CajaRecord[] | null>(null);
  readonly consumo = signal<ConsumoRecord[] | null>(null);

  // --- De dónde vino cada fuente (API vs. Excel) y el archivo/raw original (para auditoría) ---
  readonly origen = signal<Partial<Record<TipoFuente, OrigenFuente>>>({});
  readonly raw = signal<Partial<Record<TipoFuente, ArchivoCargado>>>({});

  // --- Sesión de la API de Medifolios ---
  readonly token = signal<string>('');
  readonly formasPago = signal<Record<string, string>>({});

  // --- Rango de fechas (campos #fDesde/#fHasta del original — compartidos entre
  //     "Reportes a consultar" y el período que se imprime en el Excel/Dashboard) ---
  readonly desde = signal<string>('');
  readonly hasta = signal<string>('');

  // --- Campo manual "Facturado a entidad (opcional)" del card 4 ---
  readonly facturadoEntidadManual = signal<number>(0);

  // --- Resultado de "Conciliar" (equivalente a lo que el handler de btnConciliar escribía en `state`) ---
  readonly groups = signal<GrupoConciliacion[]>([]);
  readonly resultado = signal<ResultadoConciliacion | null>(null);
  readonly origenTar = signal<OrigenTarifas | null>(null);

  readonly listoParaConciliar = computed(() => this.agenda() !== null && this.caja() !== null && this.consumo() !== null);
  readonly conciliado = computed(() => this.resultado() !== null);

  setFuente(tipo: TipoFuente, datos: AgendaRecord[] | CajaRecord[] | ConsumoRecord[], origen: OrigenFuente, raw?: ArchivoCargado) {
    if (tipo === 'AGENDA') this.agenda.set(datos as AgendaRecord[]);
    if (tipo === 'CAJA') this.caja.set(datos as CajaRecord[]);
    if (tipo === 'CONSUMO') this.consumo.set(datos as ConsumoRecord[]);
    this.origen.update((o) => ({ ...o, [tipo]: origen }));
    if (raw) this.raw.update((r) => ({ ...r, [tipo]: raw }));
  }

  reset() {
    this.agenda.set(null);
    this.caja.set(null);
    this.consumo.set(null);
    this.origen.set({});
    this.raw.set({});
    this.groups.set([]);
    this.resultado.set(null);
    this.origenTar.set(null);
  }
}
