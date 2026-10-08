import { Component, input } from '@angular/core';

/**
 * Marcador para páginas cuya ruta ya existe en la nueva arquitectura pero cuya
 * lógica todavía no se migró desde index.html. Ver MIGRATION.md para el estado
 * de cada una.
 */
@Component({
  selector: 'app-page-placeholder',
  imports: [],
  templateUrl: './page-placeholder.html',
  styleUrl: './page-placeholder.css',
})
export class PagePlaceholder {
  readonly titulo = input.required<string>();
  readonly origen = input<string>('');
}
