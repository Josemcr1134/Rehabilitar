import { Component, EventEmitter, Output, input } from '@angular/core';

/** Input de archivo reutilizable: equivalente a <input type="file"> + .fstatus del index.html original. */
@Component({
  selector: 'app-file-drop',
  imports: [],
  templateUrl: './file-drop.html',
  styleUrl: './file-drop.css',
})
export class FileDrop {
  readonly etiqueta = input.required<string>();
  readonly accept = input<string>('.xlsx,.xlsm');
  readonly mensaje = input<string>('');
  readonly error = input<boolean>(false);

  @Output() archivoSeleccionado = new EventEmitter<File>();

  onChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.archivoSeleccionado.emit(file);
  }
}
