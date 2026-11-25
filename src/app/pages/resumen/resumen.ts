import { Component, computed, inject, signal } from '@angular/core';
import { KpiCard } from '../../shared/components/kpi-card/kpi-card';
import { AppStateService } from '../../core/services/app-state.service';
import { ConciliarOrchestratorService } from '../../core/services/conciliar-orchestrator.service';
import { WorldOfficeService } from '../../core/services/world-office.service';

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

  readonly totalAnulado = computed(() => (this.O()?.anulados || []).reduce((s, a) => s + a.valor, 0));

  /** La cabecera de facturación (la misma de World Office) trae fecha, motivo y quién anuló cada documento. */
  readonly wo = inject(WorldOfficeService);
  readonly mensajeCabecera = signal('');
  anulacion(documento: string) { return this.wo.anulacionesCabecera().get(documento.replace(/\s+/g, '').toUpperCase()) || null; }

  async onCabecera(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files || []);
    input.value = '';
    for (const f of archivos) {
      try {
        const info = await this.wo.cargarCabecera(f);
        this.mensajeCabecera.set(`Cabecera «${info.nombre}» cargada${info.periodo ? ' (periodo ' + info.periodo + ')' : ''}.`);
      } catch (e) {
        this.mensajeCabecera.set(`No se pudo leer «${f.name}»: ` + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
  }

  /** Control: asume paciente + abonos + anticipos + entidades + anulados + otros = total del reporte. */
  readonly cuadraReporte = computed(() => {
    const o = this.O(); const p = this.P();
    if (!o || !p) return false;
    const f = o.fueraAsumePaciente;
    return Math.abs(p.totalAsumePaciente + f.abonosDeuda + f.anticiposRecibidos + f.entidades + f.otros + this.totalAnulado() - o.totalCaja) < 0.01;
  });

  readonly filasDesglose = computed(() => {
    const p = this.P();
    if (!p) return [];
    const notaDif: Record<string, string> = {
      CUADRA: 'cuadra: la agenda coincide con lo de caja',
      PENDIENTE: 'pendiente por conciliar: agenda menos las tres líneas anteriores',
      EXCEDENTE: 'en caja hay más de lo agendado (agenda menos las tres líneas anteriores)',
      'SIN MOVIMIENTOS': 'sin movimientos: no hay citas con tarifa ni movimientos de caja que comparar',
    };
    return [
      { lab: 'TOTAL VENTA (AGENDA)', val: p.totalVenta, nota: 'asume paciente + asume entidad', negrita: true },
      { lab: 'TOTAL SESIONES', val: p.sesiones, nota: 'citas del reporte de agenda', negrita: true, esNumero: true },
      { lab: 'ASUME PACIENTE', val: p.pac, nota: '', negrita: true },
      { lab: 'FACTURADO CON RECAUDO — PAGO DEL DÍA (ASUME PACIENTE)', val: p.pagoDelDia, nota: 'sí pagado o sí recaudado' },
      { lab: 'FACTURADO SIN RECAUDO — ANTICIPO DESCUENTO (ASUME PACIENTE)', val: p.anticipoDescuento, nota: 'facturado, no recaudado' },
      { lab: 'FACTURADO SIN RECAUDO — CRÉDITO DE DEUDA (ASUME PACIENTE)', val: p.credito, nota: 'el paciente queda debiendo' },
      { lab: 'DIFERENCIA NO CONCILIADA', val: p.difNoConciliada, nota: notaDif[p.estadoDiferencia], alerta: p.estadoDiferencia !== 'CUADRA',
        texto: p.estadoDiferencia === 'SIN MOVIMIENTOS' ? 'Sin movimientos' : undefined },
      { lab: 'ASUME ENTIDAD', val: p.ent, nota: '', negrita: true },
      { lab: 'FACTURADO A ENTIDAD', val: p.facturadoEntidad, nota: 'consumo: VLR. NETO de lo facturado (estatus F) en convenio' },
      { lab: 'NO FACTURADO ASUME ENTIDAD', val: p.noFacturadoEntidad, nota: 'pendiente por facturar' },
    ];
  });
}
