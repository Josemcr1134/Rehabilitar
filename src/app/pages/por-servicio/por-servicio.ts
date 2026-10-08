import { Component, computed, inject } from '@angular/core';
import { AppStateService } from '../../core/services/app-state.service';

function tagFor(estado: string) {
  return estado === 'Conciliado' ? 'tag-ok' : estado === 'Conteo diferente' ? 'tag-warn' : 'tag-bad';
}

/** «10. Conciliación por servicio» del index.html original — hoja «Por servicio» del Excel. */
@Component({
  selector: 'app-por-servicio',
  imports: [],
  templateUrl: './por-servicio.html',
  styleUrl: './por-servicio.css',
})
export class PorServicio {
  readonly appState = inject(AppStateService);
  readonly tagFor = tagFor;

  readonly servicios = computed(() => this.appState.resultado()?.servicios || []);
  readonly filas = computed(() => this.servicios().slice(0, 500));
}
