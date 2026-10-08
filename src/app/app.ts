import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppStateService } from './core/services/app-state.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly appState = inject(AppStateService);

  /** requiereLogin=false solo en "Conexión API" — el resto exige token (authGuard). */
  readonly nav = [
    { ruta: 'conexion-api', etiqueta: '1. Conexión API', requiereLogin: false },
    { ruta: 'carga-archivos', etiqueta: '3. Subir archivos', requiereLogin: true },
    { ruta: 'conciliar', etiqueta: '4. Conciliar', requiereLogin: true },
    { ruta: 'resumen', etiqueta: '5. Resumen', requiereLogin: true },
    { ruta: 'analisis-caja', etiqueta: '8. Análisis de caja', requiereLogin: true },
    { ruta: 'por-servicio', etiqueta: '10. Por servicio', requiereLogin: true },
    { ruta: 'relacion-caja-agenda', etiqueta: '11. Relación caja↔agenda', requiereLogin: true },
    { ruta: 'tarifas-referencia', etiqueta: '12. Tarifas por referencia', requiereLogin: true },
    { ruta: 'detalle-inconsistencias', etiqueta: '13. Detalle inconsistencias', requiereLogin: true },
    { ruta: 'world-office', etiqueta: 'World Office', requiereLogin: true },
    { ruta: 'exportar', etiqueta: '14. Exportar', requiereLogin: true },
  ];
}
