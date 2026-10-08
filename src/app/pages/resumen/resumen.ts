import { Component, computed, inject } from '@angular/core';
import { KpiCard } from '../../shared/components/kpi-card/kpi-card';
import { AppStateService } from '../../core/services/app-state.service';
import { ConciliarOrchestratorService } from '../../core/services/conciliar-orchestrator.service';

const fmt = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CO');

/** «5. Resumen ejecutivo» del index.html original — hoja «Resumen» del Excel. */
@Component({
  selector: 'app-resumen',
  imports: [KpiCard],
  templateUrl: './resumen.html',
  styleUrl: './resumen.css',
})
export class Resumen {
  readonly appState = inject(AppStateService);
  private readonly orquestador = inject(ConciliarOrchestratorService);
  readonly fmt = fmt;

  readonly O = computed(() => this.appState.origenTar());
  readonly k = computed(() => this.appState.resultado()?.kpis);
  readonly P = computed(() => this.orquestador.puente());

  readonly cuadraTarifa = computed(() => {
    const o = this.O();
    return !!o && Math.abs(o.agenda.tar - (o.agenda.pac + o.agenda.ent)) < 1;
  });

  readonly filasDesglose = computed(() => {
    const p = this.P();
    if (!p) return [];
    return [
      { lab: 'TOTAL VENTA', val: p.totalVenta, nota: 'asume paciente + asume entidad', negrita: true },
      { lab: 'TOTAL SESIONES', val: p.sesiones, nota: 'citas del reporte de agenda', negrita: true, esNumero: true },
      { lab: 'ASUME PACIENTE', val: p.pac, nota: '', negrita: true },
      { lab: 'FACTURADO CON RECAUDO — PAGO DEL DIA', val: p.pagoDelDia, nota: 'sí pagado o sí recaudado' },
      { lab: 'FACTURADO SIN RECAUDO — ANTICIPO DESCUENTO', val: p.anticipoDescuento, nota: 'facturado, no recaudado' },
      { lab: 'NO FACTURADO ASUME PACIENTE — CREDITO DEUDA', val: p.credito, nota: 'el paciente queda debiendo' },
      { lab: 'DIFERENCIA NO CONCILIADA', val: p.difNoConciliada, nota: 'agenda menos las tres líneas anteriores' },
      { lab: 'ASUME ENTIDAD', val: p.ent, nota: '', negrita: true },
      { lab: 'FACTURADO A ENTIDAD', val: p.facturadoEntidad, nota: 'consumo: VLR. NETO de lo facturado (estatus F) en convenio' },
      { lab: 'NO FACTURADO ASUME ENTIDAD', val: p.noFacturadoEntidad, nota: 'pendiente por facturar' },
    ];
  });
}
