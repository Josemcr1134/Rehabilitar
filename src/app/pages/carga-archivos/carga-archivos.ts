import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TipoFuente } from '../../core/models/records.model';
import { AppStateService } from '../../core/services/app-state.service';
import { FileLoaderService } from '../../core/services/file-loader.service';
import { FileDrop } from '../../shared/components/file-drop/file-drop';

interface EstadoCarga {
  mensaje: string;
  error: boolean;
}

/**
 * «Opción B · Subir archivos Excel» del index.html original: carga manual de
 * AGENDA/CAJA/CONSUMO, independiente de la API — sigue siendo el camino de
 * respaldo confiable (CLAUDE.md sección 11 y 13).
 */
@Component({
  selector: 'app-carga-archivos',
  imports: [FileDrop],
  templateUrl: './carga-archivos.html',
  styleUrl: './carga-archivos.css',
})
export class CargaArchivos {
  private readonly fileLoader = inject(FileLoaderService);
  private readonly router = inject(Router);
  readonly appState = inject(AppStateService);

  readonly estados = signal<Record<TipoFuente, EstadoCarga>>({
    AGENDA: { mensaje: '', error: false },
    CAJA: { mensaje: '', error: false },
    CONSUMO: { mensaje: '', error: false },
  });

  async onArchivo(tipo: TipoFuente, file: File) {
    this.estados.update((e) => ({ ...e, [tipo]: { mensaje: 'Leyendo archivo...', error: false } }));
    const resultado = await this.fileLoader.cargarArchivo(tipo, file);
    this.estados.update((e) => ({ ...e, [tipo]: { mensaje: resultado.mensaje, error: !resultado.ok } }));
  }

  irAConciliar() {
    this.router.navigateByUrl('/conciliar');
  }
}
