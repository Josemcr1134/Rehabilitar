import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TipoFuente } from '../../core/models/records.model';
import { AppStateService } from '../../core/services/app-state.service';
import { MedifoliosApiService } from '../../core/services/medifolios-api.service';
import { FileLoaderService } from '../../core/services/file-loader.service';
import { apiJsonAplano, aplanarFormasPagoCaja } from '../../core/utils/api-flatten.util';

interface EstadoFuente { mensaje: string; error: boolean }

/** «Opción A · 1. Conexión a la plataforma» + «2. Reportes a consultar» del index.html original. */
@Component({
  selector: 'app-conexion-api',
  imports: [FormsModule],
  templateUrl: './conexion-api.html',
  styleUrl: './conexion-api.css',
})
export class ConexionApi {
  private readonly api = inject(MedifoliosApiService);
  private readonly fileLoader = inject(FileLoaderService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly appState = inject(AppStateService);

  usuario = '';
  password = '';
  readonly estado = signal('');
  readonly crudo = signal('');
  readonly conectando = signal(false);
  /** Si authGuard redirigió aquí, a dónde volver después de loguearse. */
  readonly returnUrl = signal<string | null>(this.route.snapshot.queryParamMap.get('returnUrl'));

  readonly estados = signal<Record<TipoFuente, EstadoFuente>>({
    AGENDA: { mensaje: '', error: false },
    CAJA: { mensaje: '', error: false },
    CONSUMO: { mensaje: '', error: false },
  });

  async conectar() {
    if (!this.usuario || !this.password) { this.estado.set('Escribe usuario y contraseña.'); return; }
    this.conectando.set(true);
    this.estado.set('Conectando...');
    const r = await this.api.autenticar(this.usuario, this.password);
    this.estado.set(r.mensaje);
    this.crudo.set(r.crudo.slice(0, 2000));
    this.password = ''; // la clave no queda en pantalla
    if (r.ok) {
      await this.api.cargarFormasPago();
      const destino = this.returnUrl();
      if (destino) { this.returnUrl.set(null); this.router.navigateByUrl(destino); }
    }
    this.conectando.set(false);
  }

  private marcar(tipo: TipoFuente, mensaje: string, error = false) {
    this.estados.update((e) => ({ ...e, [tipo]: { mensaje, error } }));
  }

  async consultarAgenda() {
    this.marcar('AGENDA', 'Consultando...');
    try {
      const arr = await this.api.consultarCitas(this.appState.desde(), this.appState.hasta());
      const plano = apiJsonAplano('AGENDA', arr, this.appState.formasPago());
      const r = this.fileLoader.guardarDesdeApi('AGENDA', plano);
      this.marcar('AGENDA', r.mensaje, !r.ok);
    } catch (err: any) {
      this.marcar('AGENDA', 'Error: ' + (err?.message || err), true);
    }
  }

  async consultarConsumo() {
    this.marcar('CONSUMO', 'Consultando...');
    try {
      const arr = await this.api.consultarConsumos(this.appState.desde(), this.appState.hasta());
      const plano = apiJsonAplano('CONSUMO', arr, this.appState.formasPago());
      const r = this.fileLoader.guardarDesdeApi('CONSUMO', plano);
      this.marcar('CONSUMO', r.mensaje, !r.ok);
    } catch (err: any) {
      this.marcar('CONSUMO', 'Error: ' + (err?.message || err), true);
    }
  }

  async consultarCaja() {
    this.marcar('CAJA', 'Consultando...');
    try {
      const facturas = await this.api.consultarFacturacion(this.appState.desde(), this.appState.hasta());
      // Una factura con varias formas de pago se abre en una fila por forma de pago,
      // igual que en el reporte de caja del MODELO1.
      const aplanadoFacturas = aplanarFormasPagoCaja(facturas);
      const plano = apiJsonAplano('CAJA', aplanadoFacturas, this.appState.formasPago());
      const r = this.fileLoader.guardarDesdeApi('CAJA', plano);
      this.marcar('CAJA', r.mensaje, !r.ok);
    } catch (err: any) {
      this.marcar('CAJA', 'Error: ' + (err?.message || err), true);
    }
  }
}
