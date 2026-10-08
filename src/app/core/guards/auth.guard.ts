import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppStateService } from '../services/app-state.service';

/**
 * Exige un token de Medifolios vigente (AppStateService.token(), obtenido en
 * «1. Conexión API») para entrar a cualquier otra pestaña — incluida «Subir
 * archivos»: decisión de producto, no una limitación técnica. Sin token,
 * redirige a conexión-api y le pasa a dónde quería ir para volver ahí después
 * de loguearse.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const appState = inject(AppStateService);
  const router = inject(Router);
  if (appState.token()) return true;
  return router.createUrlTree(['/conexion-api'], { queryParams: { returnUrl: state.url } });
};
