import { Component, computed, inject, signal } from '@angular/core';
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
  /** Búsqueda por paciente (nombre o documento de identidad) o por servicio. */
  readonly busqueda = signal('');
  readonly filtroEstado = signal('');
  readonly estados = computed(() => [...new Set(this.servicios().map((s) => s.estado))].filter(Boolean));
  readonly filtradas = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const e = this.filtroEstado();
    return this.servicios()
      .filter((s) => !e || s.estado === e)
      .filter((s) => !q || s.id.includes(q) || s.nombre.toLowerCase().includes(q) || s.servicio.toLowerCase().includes(q));
  });
  readonly filas = computed(() => this.filtradas().slice(0, 500));
  /** Pacientes distintos (por documento de identidad) en el resultado filtrado. */
  readonly pacientes = computed(() => new Set(this.filtradas().map((s) => s.id)).size);
}
