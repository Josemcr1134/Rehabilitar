import { Component, computed, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/services/app-state.service';

const mon = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('es-CO'));

/** «12. Tarifas por referencia / ítem / descripción» del index.html original — hoja «REFERENCIAITEMDESCRIPCION» del Excel. */
@Component({
  selector: 'app-tarifas-referencia',
  imports: [],
  templateUrl: './tarifas-referencia.html',
  styleUrl: './tarifas-referencia.css',
})
export class TarifasReferencia {
  readonly appState = inject(AppStateService);
  readonly mon = mon;
  readonly soloNovedad = signal(false);

  readonly referencias = computed(() => this.appState.resultado()?.referencias || []);
  readonly filas = computed(() => {
    const rows = this.referencias();
    return (this.soloNovedad() ? rows.filter((r) => r.estado !== 'Cuadra') : rows).slice(0, 500);
  });
  readonly kpis = computed(() => this.appState.resultado()?.kpis);

  tagClase(estado: string) {
    return estado === 'Cuadra' ? 'tag-ok' : estado === 'Diferencia' ? 'tag-bad' : 'tag-warn';
  }
}
