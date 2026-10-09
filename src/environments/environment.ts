/**
 * Entorno de desarrollo (el que usa `ng serve` / `ng test` por defecto).
 *
 * `worldOfficeApiBase` apunta al backend propio api/worldoffice.js (una función
 * de Vercel en producción; `npm run wo:dev` en local, vía proxy.conf.json): el
 * navegador ya no habla directo con World Office ni conoce su token.
 *
 * `medifoliosApiBase`/`worldOfficeApiBase` son los mismos prefijos relativos
 * aquí y en producción a propósito: lo que cambia entre entornos no es la ruta
 * que llama el código, sino quién la reescribe hacia el host real —
 * `proxy.conf.json` en desarrollo, los `rewrites` de `vercel.json` en
 * producción. Si alguno de esos dos prefijos cambia, hay que actualizar los
 * TRES archivos (este, `environment.prod.ts` y el proxy/rewrite correspondiente):
 * no hay forma de que compartan una sola fuente, porque uno lo lee esbuild al
 * compilar el app y los otros los lee una herramienta externa (webpack-dev-server
 * / Vercel) que nunca ve este archivo.
 */
export const environment = {
  production: false,
  medifoliosApiBase: '/api',
  worldOfficeApiBase: '/api/worldoffice',
};
