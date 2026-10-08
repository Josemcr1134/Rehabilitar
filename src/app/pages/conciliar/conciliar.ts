import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConciliarOrchestratorService } from '../../core/services/conciliar-orchestrator.service';
import { GrupoConciliacion, okColumn } from '../../core/utils/comparacion.util';
import { AppStateService } from '../../core/services/app-state.service';

const ESTADO_COLORES: Record<string, string> = {
  Conciliado: '#28A028', 'Conteo diferente': '#F0C800', 'Solo agenda': '#C80078',
  'Solo caja': '#C80078', 'Solo consumo': '#C80078', Incompleto: '#F0A028',
};
const CAT_COLORES: Record<string, string> = {
  PAGO_NORMAL: '#28A028', ANTICIPO: '#F0C800', ANTICIPO_EMPRESA: '#F0A028', TRANSF_FACTURACION: '#005078',
  CREDITO: '#C80078', AJUSTE: '#7a7a7a', ANULADO: '#b23b3b', SIN_VALOR: '#aeb6bd',
};

/**
 * Card «4. Conciliar» + «6. Distribución por estado» + «7. Movimientos de CAJA
 * por categoría» + «9. Conciliación por paciente» del index.html original —
 * se agrupan en una sola página porque en el original se disparan todas del
 * mismo botón y se muestran en secuencia inmediatamente después.
 */
@Component({
  selector: 'app-conciliar',
  imports: [FormsModule, DecimalPipe],
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

  readonly barrasEstado = computed(() => {
    const counts: Record<string, number> = {};
    this.appState.groups().forEach((g) => { counts[g.estado] = (counts[g.estado] || 0) + 1; });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts).map(([estado, n]) => ({ estado, n, pct: (n / max) * 100, color: ESTADO_COLORES[estado] || '#999' }));
  });

  readonly barrasCategoria = computed(() => {
    const cats = this.appState.resultado()?.cats || ({} as Record<string, { count: number; valor: number }>);
    const max = Math.max(1, ...Object.values(cats).map((c) => c.count));
    return Object.entries(cats).map(([cat, v]) => ({ cat, n: v.count, valor: v.valor, pct: (v.count / max) * 100, color: CAT_COLORES[cat] || '#999' }));
  });

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
