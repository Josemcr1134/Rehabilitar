import { Component, input } from '@angular/core';

/** Equivalente del `.kpi` del index.html original: una tarjeta con un valor grande y una etiqueta. */
@Component({
  selector: 'app-kpi-card',
  imports: [],
  templateUrl: './kpi-card.html',
  styleUrl: './kpi-card.css',
})
export class KpiCard {
  readonly valor = input.required<string | number>();
  readonly etiqueta = input.required<string>();
  /** 'ok' | 'warn' | 'bad' | '' — mismo semáforo que .kpi.ok/.kpi.warn/.kpi.bad en el original. */
  readonly estado = input<'ok' | 'warn' | 'bad' | ''>('');
}
