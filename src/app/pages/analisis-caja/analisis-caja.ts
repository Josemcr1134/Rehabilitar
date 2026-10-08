import { Component, computed, inject, signal } from '@angular/core';
import { ORDEN_GRUPOS } from '../../core/models/clasificacion.model';
import { AppStateService } from '../../core/services/app-state.service';
import { KpiCard } from '../../shared/components/kpi-card/kpi-card';

const fmt = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CO');
const mon = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('es-CO'));

/** «8. Análisis de caja por código de documento» del index.html original — hoja «analisis_caja» del Excel. */
@Component({
  selector: 'app-analisis-caja',
  imports: [KpiCard],
  templateUrl: './analisis-caja.html',
  styleUrl: './analisis-caja.css',
})
export class AnalisisCaja {
  readonly appState = inject(AppStateService);
  readonly fmt = fmt;
  readonly mon = mon;
  readonly soloInconsistencia = signal(false);

  readonly t = computed(() => this.appState.resultado()?.cajaTot);

  readonly filasGrupo = computed(() => {
    const porGrupo = this.appState.resultado()?.porGrupo || {};
    return ORDEN_GRUPOS.filter((g) => porGrupo[g]).map((g) => ({ g, v: porGrupo[g] }));
  });

  readonly filasStatus = computed(() => {
    const porStatus = this.appState.resultado()?.porStatus || {};
    return Object.entries(porStatus).sort(([a], [b]) => a.localeCompare(b));
  });

  readonly filasPref = computed(() => {
    const matrizPref = this.appState.resultado()?.matrizPref || {};
    return Object.entries(matrizPref)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pr, v]) => ({ pr, v, detalle: Object.entries(v.formas).sort(([a], [b]) => a.localeCompare(b)).map(([f, d]) => `${f} (${d.n})`).join(' · ') }));
  });

  readonly filas = computed(() => {
    const rows = this.appState.resultado()?.analisisCaja || [];
    return (this.soloInconsistencia() ? rows.filter((x) => x.inconsistencias) : rows).slice(0, 500);
  });

  readonly totalFilas = computed(() => this.appState.resultado()?.analisisCaja.length || 0);
}
