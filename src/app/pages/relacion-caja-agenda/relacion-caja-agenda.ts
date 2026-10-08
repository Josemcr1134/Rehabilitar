import { Component, computed, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/services/app-state.service';
import { KpiCard } from '../../shared/components/kpi-card/kpi-card';

/** «11. Relación caja ↔ agenda» del index.html original — hoja «relacion_caja_agenda» del Excel. */
@Component({
  selector: 'app-relacion-caja-agenda',
  imports: [KpiCard],
  templateUrl: './relacion-caja-agenda.html',
  styleUrl: './relacion-caja-agenda.css',
})
export class RelacionCajaAgenda {
  readonly appState = inject(AppStateService);
  readonly soloRevisar = signal(true);

  readonly t = computed(() => this.appState.resultado()?.relTot);
  readonly relacion = computed(() => this.appState.resultado()?.relacion || []);
  readonly filas = computed(() => {
    const rows = this.relacion();
    return (this.soloRevisar() ? rows.filter((r) => r.estado === 'Revisar') : rows).slice(0, 500);
  });
}
