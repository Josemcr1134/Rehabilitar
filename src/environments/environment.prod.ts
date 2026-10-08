/**
 * Entorno de producción — lo activa `fileReplacements` en la configuración
 * "production" de angular.json (sustituye a environment.ts en ese build).
 * Ver el comentario de environment.ts sobre por qué los prefijos son iguales.
 */
export const environment = {
  production: true,
  medifoliosApiBase: '/api',
  worldOfficeApiBase: '/wo',
};
