import { Component, computed, inject } from '@angular/core';
import { AppStateService } from '../../core/services/app-state.service';

function tagFor(estado: string) {
  return estado === 'Conciliado' ? 'tag-ok' : estado === 'Conteo diferente' ? 'tag-warn' : 'tag-bad';
}

/** «13. Detalle por inconsistencia» del index.html original. */
@Component({
  selector: 'app-detalle-inconsistencias',
  imports: [],
  templateUrl: './detalle-inconsistencias.html',
  styleUrl: './detalle-inconsistencias.css',
})
export class DetalleInconsistencias {
  readonly appState = inject(AppStateService);
  readonly tagFor = tagFor;

  readonly incidencias = computed(() =>
    this.appState.groups().filter((g) => g.estado !== 'Conciliado' || g.comparaciones.some((c) => !c.coincide)),
  );
  readonly filas = computed(() => this.incidencias().slice(0, 300));
}
