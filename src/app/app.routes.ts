import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

/**
 * Una ruta por cada "card" numerada del index.html original (1, 3-14 — el "2.
 * Reportes a consultar" vive dentro de conexion-api, y "World Office" es un
 * bloque aparte sin número en el original). Ver MIGRATION.md.
 *
 * Carga perezosa (loadComponent) en todas las rutas: la página "Exportar"
 * depende de ExcelExportService → exceljs (CommonJS, pesado) y si se importa
 * de forma eager termina en el chunk principal, superando el budget de
 * producción. Lazy-loading además es la práctica idiomática en standalone.
 *
 * authGuard en todas las rutas salvo "conexion-api": acceder a cualquier otra
 * pestaña — incluida "Subir archivos" — exige tener token de Medifolios.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'conexion-api', pathMatch: 'full' },
  { path: 'conexion-api', loadComponent: () => import('./pages/conexion-api/conexion-api').then((m) => m.ConexionApi), title: 'Conexión API · Rehabilitar' },
  { path: 'carga-archivos', loadComponent: () => import('./pages/carga-archivos/carga-archivos').then((m) => m.CargaArchivos), title: 'Subir archivos · Rehabilitar', canActivate: [authGuard] },
  { path: 'conciliar', loadComponent: () => import('./pages/conciliar/conciliar').then((m) => m.Conciliar), title: 'Conciliar · Rehabilitar', canActivate: [authGuard] },
  { path: 'resumen', loadComponent: () => import('./pages/resumen/resumen').then((m) => m.Resumen), title: 'Resumen · Rehabilitar', canActivate: [authGuard] },
  { path: 'analisis-caja', loadComponent: () => import('./pages/analisis-caja/analisis-caja').then((m) => m.AnalisisCaja), title: 'Análisis de caja · Rehabilitar', canActivate: [authGuard] },
  { path: 'por-servicio', loadComponent: () => import('./pages/por-servicio/por-servicio').then((m) => m.PorServicio), title: 'Por servicio · Rehabilitar', canActivate: [authGuard] },
  { path: 'relacion-caja-agenda', loadComponent: () => import('./pages/relacion-caja-agenda/relacion-caja-agenda').then((m) => m.RelacionCajaAgenda), title: 'Relación caja↔agenda · Rehabilitar', canActivate: [authGuard] },
  { path: 'tarifas-referencia', loadComponent: () => import('./pages/tarifas-referencia/tarifas-referencia').then((m) => m.TarifasReferencia), title: 'Tarifas por referencia · Rehabilitar', canActivate: [authGuard] },
  { path: 'detalle-inconsistencias', loadComponent: () => import('./pages/detalle-inconsistencias/detalle-inconsistencias').then((m) => m.DetalleInconsistencias), title: 'Detalle inconsistencias · Rehabilitar', canActivate: [authGuard] },
  { path: 'world-office', loadComponent: () => import('./pages/world-office/world-office').then((m) => m.WorldOffice), title: 'World Office · Rehabilitar', canActivate: [authGuard] },
  { path: 'exportar', loadComponent: () => import('./pages/exportar/exportar').then((m) => m.Exportar), title: 'Exportar · Rehabilitar', canActivate: [authGuard] },
  { path: '**', redirectTo: 'conexion-api' },
];
