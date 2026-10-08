import { Component, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/services/app-state.service';
import { ExcelExportService } from '../../core/services/excel-export.service';

/** «14. Exportar» del index.html original — botón "⬇ Descargar Excel (formato MODELO1)". */
@Component({
  selector: 'app-exportar',
  imports: [],
  templateUrl: './exportar.html',
  styleUrl: './exportar.css',
})
export class Exportar {
  private readonly excelExport = inject(ExcelExportService);
  readonly appState = inject(AppStateService);
  readonly generando = signal(false);
  readonly mensaje = signal('');

  async descargarExcel() {
    this.generando.set(true);
    this.mensaje.set('Generando Excel...');
    try {
      await this.excelExport.generar(this.appState.desde(), this.appState.hasta());
      this.mensaje.set('Excel descargado ✔');
    } catch (err: any) {
      this.mensaje.set('Error: ' + (err?.message || err));
    } finally {
      this.generando.set(false);
    }
  }
}
