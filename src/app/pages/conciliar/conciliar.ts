import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConciliarOrchestratorService } from '../../core/services/conciliar-orchestrator.service';
import { GrupoConciliacion, okColumn } from '../../core/utils/comparacion.util';
import { ServicioRow } from '../../core/models/conciliacion-resultado.model';
import { AppStateService } from '../../core/services/app-state.service';
import { Resumen } from '../resumen/resumen';

/**
 * Card «4. Conciliar» + «5. Resumen ejecutivo» + «9. Conciliación por paciente».
 * Al conciliar se muestra de una vez el resumen ejecutivo (el mismo componente de
 * la pestaña «Resumen»). Las gráficas de barras «6. Distribución por estado» y
 * «7. Movimientos de CAJA por categoría» se quitaron a pedido del usuario.
 */
@Component({
  selector: 'app-conciliar',
  imports: [FormsModule, Resumen],
  templateUrl: './conciliar.html',
  styleUrl: './conciliar.css',
})
export class Conciliar {
  private readonly orquestador = inject(ConciliarOrchestratorService);
  readonly appState = inject(AppStateService);

  readonly busqueda = signal('');
  readonly filtroEstado = signal('');

  readonly estadosDisponibles = computed(() => [...new Set(this.appState.groups().map((g) => g.estado))].filter(Boolean));

  readonly filasFiltradas = computed(() => {
    const q = this.busqueda().toLowerCase();
    const est = this.filtroEstado();
    return this.appState.groups()
      .filter((g) => !est || g.estado === est)
      .filter((g) => !q || g.nombre.toLowerCase().includes(q) || g.id.includes(q))
      .slice(0, 500);
  });

  /** Paciente (documento de identidad) con su detalle por servicio desplegado. */
  readonly abierto = signal('');

  /** Servicios conciliados por paciente, agrupados por DOCUMENTO DE IDENTIDAD (nunca por nombre). */
  readonly serviciosPorPaciente = computed(() => {
    const m = new Map<string, ServicioRow[]>();
    for (const s of this.appState.resultado()?.servicios || []) {
      if (!m.has(s.id)) m.set(s.id, []);
      m.get(s.id)!.push(s);
    }
    return m;
  });

  serviciosDe(id: string): ServicioRow[] { return this.serviciosPorPaciente().get(id) || []; }

  /** Control: lo contado por servicio debe sumar lo mismo que el grupo del paciente. */
  cuadraConServicios(g: GrupoConciliacion): boolean {
    const ss = this.serviciosDe(g.id);
    const t = ss.reduce((a, s) => ({ ag: a.ag + s.ag, cj: a.cj + s.cj, co: a.co + s.co }), { ag: 0, cj: 0, co: 0 });
    return t.ag === g.countAgenda && t.cj === g.countCaja && t.co === g.countConsumo;
  }

  alternar(id: string) { this.abierto.set(this.abierto() === id ? '' : id); }

  conciliar() {
    this.orquestador.ejecutar();
  }

  onFacturadoEntidadChange(valor: string) {
    this.appState.facturadoEntidadManual.set(Number(valor) || 0);
  }

  campo(g: GrupoConciliacion, label: string) {
    return g.comparaciones.find((c) => c.campo === label);
  }

  ok(g: GrupoConciliacion, label: string) {
    return okColumn(this.campo(g, label));
  }

  tagClase(estado: string) {
    return estado === 'Conciliado' ? 'tag-ok' : estado === 'Conteo diferente' ? 'tag-warn' : 'tag-bad';
  }
}
