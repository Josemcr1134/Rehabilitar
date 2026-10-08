# Migración a Angular — estado

Origen: `/Users/josemanuelcuello/Desktop/LILIAN/index.html` (single-file, `APP_VERSION: v2026.10.07-1`,
3495 líneas). **Ese archivo sigue siendo la versión en producción** — esta migración no lo toca ni lo
reemplaza todavía; corre en paralelo hasta que cada página quede migrada y verificada.

## ⚠️ Hallazgo importante antes de seguir

El `index.html` actual en disco **no tiene** varios refinamientos de negocio que se construyeron en
una sesión de trabajo anterior sobre el mismo archivo (y que por tanto esta migración tampoco trae
todavía), entre ellos:

- El grupo `PAGO DE DEUDA` seccionado por persona natural / jurídica (hoy es un solo grupo).
- El renombre `RADICADO A ENTIDAD` → `RADICADO ENTIDAD`.
- `esEmpresaTercero()` (usa el tipo de documento confirmado antes de caer a la heurística de `esNit()`).
- El cruce con el reporte "Cabecera Facturación" dentro de `analisis_caja` / `Por servicio`
  (columna OBSERVACIÓN, Estado Anulada/Facturada, Prefijo Inválido extendido).
- Las secciones "Registros anulados" y "Reemplazos" del Resumen.
- El resaltado lila cruzado entre hojas para pacientes con novedad.
- El endpoint RIPS / IA (`rips-ia`) con las columnas Paciente y Mensaje de validación limpio.

En cambio, el archivo actual **sí tiene** la integración con World Office (CLAUDE.md sección 15),
que no existía en esa sesión anterior.

**Conclusión:** esta migración está hecha 1:1 contra lo que existe hoy en `index.html`, verificado
línea por línea al escribir cada archivo de `core/`. Antes de dar por completa cualquier página,
confirmar contra el `index.html` real en ese momento — puede haber seguido cambiando.

## ⚠️ Desviación deliberada: login obligatorio en todas las pestañas

El `index.html` original no tiene esta restricción — es una decisión tomada **solo para esta
migración a Angular**, porque el original no tenía pestañas/rutas separadas (todo vivía en una
sola página). Decisión de producto (2026-10-07): **todas las rutas excepto "Conexión API" exigen
tener token de Medifolios** (`core/guards/auth.guard.ts`, `AppStateService.token()`), incluida
**"Subir archivos"**.

Esto contradice a propósito el principio documentado en CLAUDE.md sección 11: *"La opción de carga
manual (subida de .xlsx) funciona de forma independiente de la API [...] es el camino de respaldo
confiable y el que hay que usar mientras la conexión no esté resuelta."* Esa independencia dejó de
existir en la versión Angular: si el login a Medifolios está roto (ver backlog sección 12, 404 en
`/api/auth`), nadie puede entrar a ninguna pestaña de uso, ni siquiera a subir archivos a mano. Se
preguntó explícitamente al usuario antes de implementarlo así y la respuesta fue confirmarlo dos
veces (incluir "Subir archivos" en el guard a pesar de la advertencia). No "arreglar" esto sin
volver a preguntar.

## ⚠️ Desviación deliberada: el token de World Office se guarda en el navegador

El `index.html` original pedía el token de World Office en pantalla cada vez y nunca lo guardaba
(CLAUDE.md sección 15: *"Se pega en pantalla cada vez; no se guarda"*). En la migración a Angular
esto cambió a propósito (decisión de producto, 2026-10-07), después de revisar la documentación
oficial de World Office (developer.worldoffice.cloud): **no existe un login usuario/contraseña por
API como el de Medifolios** — el único token válido se copia a mano desde la interfaz web de World
Office (Configuración › Configuración General › API), con una expiración que puede fijarse hasta el
vencimiento de la licencia. Como quien usa esta pestaña no es técnico, pedir ese token en cada
sesión era la única fricción real que se podía reducir.

Implementación (`core/services/world-office.service.ts`): el token se guarda en
`localStorage` (clave `rehabilitar_wo_token_v1`) tras un `conectar()` exitoso, se borra solo si
World Office lo rechaza (401/403) o si la persona hace clic en **"Cerrar sesión de World Office"**
(botón visible en la página, llama a `wo.cerrarSesion()`). Al volver a la página, si hay un token
guardado y no hay catálogos cargados en memoria, `WorldOffice` (el componente) reconecta solo, sin
que la persona tenga que hacer nada. Riesgo aceptado a propósito: cualquiera con acceso a ese
navegador puede crear/anular documentos reales en la contabilidad sin que se le vuelva a pedir el
token — por eso el botón de cerrar sesión está siempre visible mientras hay una sesión activa.

## Arquitectura

```
src/app/
├── core/
│   ├── models/      — interfaces y constantes de negocio (sin lógica)
│   ├── services/     — Injectable providedIn:'root' (estado, API, import, conciliación)
│   ├── utils/         — funciones puras, sin Angular (fáciles de testear aisladas)
│   └── guards/        — auth.guard.ts (exige token de Medifolios en todas las rutas salvo conexion-api)
├── pages/<feature>/    — una carpeta por "card" numerada del index.html original
├── shared/
│   ├── components/     — kpi-card, file-drop, page-placeholder
│   ├── pipes/           — (vacío)
│   └── directives/      — (vacío)
├── app.routes.ts
├── app.ts / .html / .css   — shell con navegación
└── app.config.ts
```

Angular 21, componentes standalone, signals para estado (reemplaza al objeto global `state` del
original), `HttpClient` en vez de `fetch`, `exceljs` (mismo paquete que el CDN del original) para
leer/escribir Excel.

## Qué está migrado y funcionando

| Página / pieza | Estado | Equivalente en index.html |
|---|---|---|
| `core/models/*` | ✅ Completo | `SCHEMAS`, `FP`, `REGLAS_DOC`, `ORDEN_GRUPOS`, tipos de registro |
| `core/utils/normalizacion.util.ts` | ✅ Completo | `up`, `findCol`, `scoreSchema`, `normFecha`, `normId`, `normNombre`, `normServicio`, `toNumber`, `parseMoneda`, `levenshtein` |
| `core/utils/tarifa.util.ts` | ✅ Completo | `extraerTarifa`, `tarifaDeCampo`, `servicioBase`, `tarifaDeFuente`, `compararNumeros` |
| `core/utils/clasificacion.util.ts` | ✅ Completo | `esNit`, `classifyCaja`, `normalizarFormaPago`, `prefijoDocumento`, `clasificarMovimiento` |
| `core/utils/build-records.util.ts` | ✅ Completo | `buildRecordsFromJson`, `normalizeRecords` (las tres ramas) |
| `core/utils/comparacion.util.ts` | ✅ Completo | `CAMPOS_COMPARABLES`, `compararCampo`, `estadoConciliacion`, `construirObservacion/Accion` |
| `core/utils/origen-tarifas.util.ts` | ✅ Completo | `analizarOrigenTarifas`, `puenteAgenda` |
| `core/utils/api-flatten.util.ts` | ✅ Completo | `apiJsonAplano`, `aplanarFormasPagoCaja` (handler de `btnCaja`) |
| `core/utils/descargar.util.ts` | ✅ Completo | `descargar()` |
| `core/services/excel-import.service.ts` | ✅ Completo | `detectarEncabezado`, `hojaAObjetos`, `matrizDeHoja`, `cargarExcel` |
| `core/services/file-loader.service.ts` | ✅ Completo | `procesarArrayComoTipo` (ramas Excel y API) |
| `core/services/app-state.service.ts` | ✅ Completo | objeto global `state` |
| `core/services/medifolios-api.service.ts` | ✅ Completo | auth, `llamarApi`, `llamarApiPaginado`, `cargarFormasPago`, `consultarCitas/Consumos/Facturacion` |
| `core/services/conciliar-orchestrator.service.ts` | ✅ Completo | handler completo de `btnConciliar` (groups, servicios, referencias, relación, analisisCaja, cats, kpis) + `puenteAgenda` on-demand |
| `core/services/excel-export.service.ts` | ✅ Completo | handler de `btnExcel` — 9 hojas, colores y anchos idénticos |
| **Página: Conexión API** | ✅ Funcional | Cards "1. Conexión" + "2. Reportes a consultar" |
| **Página: Subir archivos** | ✅ Funcional | Card "3. Subir archivos Excel" |
| **Página: Conciliar** | ✅ Funcional | Cards "4" (manual Facturado a entidad), "6" (distribución por estado), "7" (caja por categoría), "9" (conciliación por paciente) |
| **Página: Resumen** | ✅ Funcional | Card "5. Resumen ejecutivo" |
| **Página: Análisis de caja** | ✅ Funcional | Card "8. Análisis de caja" |
| **Página: Por servicio** | ✅ Funcional | Card "10. Por servicio" |
| **Página: Relación caja↔agenda** | ✅ Funcional | Card "11" |
| **Página: Tarifas por referencia** | ✅ Funcional | Card "12" |
| **Página: Detalle inconsistencias** | ✅ Funcional | Card "13" |
| **Página: Exportar (Excel)** | ✅ Funcional | Card "14. Exportar" — botón "Descargar Excel" |
| `core/models/world-office.model.ts` | ✅ Completo | `WO_CONFIG`, `TABLA_A`, `PRODUCTO`, `CENTROS` |
| `core/utils/world-office.util.ts` | ✅ Completo | `servicioDe`, `centroDe`, `itemsDe`, `conceptoCombinado`, `prepararDocumentos`, `controles` — con pruebas en `world-office.util.spec.ts` |
| `core/services/world-office.service.ts` | ✅ Completo | `woFetch`, `listarTodo`, `cargarCatalogos`, `armarFactura`, `armarRecibo`, `buscarExistente`/`yaExiste`, `enviar`, `descargarPlantilla`, `descargarBitacora` |
| **Página: World Office** | ✅ Funcional | Tarjeta "World Office · Facturas (FV) y recibos (RC) desde Caja" (CLAUDE.md sección 15) — Conectar → Preparar → Simular/Enviar, catálogos, tabla de documentos con selección, bitácora |
| **Dashboard HTML** (`btnDashboard`) | 🚧 No migrado todavía | Genera `Dashboard_Rehabilitar_<periodo>.html` autocontenido — no tiene página ni servicio propio aún |

Nota: las páginas RIPS/IA y Cabecera Facturación mencionadas en el hallazgo de arriba **no existen
en el `index.html` real** (confirmado por grep: cero coincidencias de `ripsCard`, `fileCabecera`,
`cabeceraCard`). Las carpetas que se habían creado para ellas se eliminaron del proyecto Angular
para no migrar funcionalidad fantasma.

## Pendiente

1. **Dashboard HTML** — portar el handler `btnDashboard` (genera el HTML autocontenido con el JSON
   de datos + logo embebido). Candidato a `DashboardExportService` junto a `exportar`.
2. **Pruebas de regresión contra las cifras de control** (CLAUDE.md sección 10, corte 2026-07) —
   hoy hay una prueba de humo end-to-end (`core/services/integracion.smoke.spec.ts`) que verifica
   que el pipeline de conciliación+Excel corre sin errores con datos sintéticos, y pruebas unitarias
   de `prepararDocumentos` de World Office (`core/utils/world-office.util.spec.ts`); ninguna compara
   contra las cifras exactas de control (ni el corte 2026-07 de conciliación, ni el corte 2026-08-04
   de World Office: 51 movimientos, 25 facturas $661.900, 6 recibos $429.500).
3. **World Office: probar contra la cuenta real** (CLAUDE.md sección 15, pendiente 1) — lo migrado
   aquí reproduce la lógica tal cual estaba en index.html, pero esa lógica en sí nunca se probó
   contra la API real de World Office (solo contra una API simulada). "Conectar" → revisar catálogos
   en rojo → "Simular" → enviar 2-3 documentos.
4. **Desplegar en Vercel** — `vercel.json` ya existe en esta carpeta, pero como el proyecto vive en
   `LILIAN/rehabilitar-angular/` y `LILIAN/` tiene su propio `vercel.json` (el del index.html en
   producción), el proyecto de Vercel para Angular debe tener **Root Directory =
   `rehabilitar-angular`**, framework Angular, build `npm run build`. Si se reutiliza el mismo
   proyecto de Vercel del index.html, cambiar el Root Directory reemplaza el sitio en producción —
   hacerlo solo cuando se decida el reemplazo.

## Cómo correr

```bash
npm install          # ya instalado en este checkout
npm start             # ng serve — usa proxy.conf.json, igual que vercel.json pero en local
npm test              # vitest vía @angular/build:unit-test
npm run build         # build de producción — rutas con loadComponent (lazy) para mantener
                       # exceljs fuera del bundle inicial (budget de 1 MB)
```

### Conexión a las dos APIs (environments + proxy + vercel.json)

Tres piezas que deben mantenerse sincronizadas a mano:

| Archivo | Lo lee | Qué define |
|---|---|---|
| `src/environments/environment.ts` / `environment.prod.ts` | el código (servicios) | `medifoliosApiBase: '/api'`, `worldOfficeApiBase: '/wo'` — el prefijo al que llaman `MedifoliosApiService` y `WO_CONFIG.apiBase` |
| `proxy.conf.json` | `ng serve` (desarrollo) | reescribe `/api/**` → `balanceo-reportes.medifolios.net/ci4/public/v2` y `/wo/**` → `api.worldoffice.cloud/api/v1` |
| `vercel.json` | Vercel (producción) | los mismos dos rewrites + fallback SPA `/(.*)` → `/index.html` |

Los prefijos son iguales en desarrollo y producción a propósito: lo que cambia entre entornos no es
la ruta que llama el código, sino quién la reescribe hacia el host real. `angular.json` activa
`environment.prod.ts` con `fileReplacements` en la configuración `production`.

#### ⚠️ `proxy.conf.json` necesita `**`, no `*` (2026-10-08)

Un contexto bare `"/wo"` hace match por prefijo y secuestra la ruta Angular `/world-office` — eso se
detectó primero y se "arregló" cambiando a `/wo/*` / `/api/*`. Esa forma con **una sola** estrella
resultó ser un bug distinto: en el motor de glob que usa `@angular/build:dev-server`, `*` no cruza
`/`, así que solo igualaba rutas de **un** segmento (`/api/auth`, `/wo/documentos`) y dejaba pasar
cualquier ruta real de dos o más segmentos (`/api/citas/listar`, `/api/consumos/buscar`,
`/wo/empresas/listarEmpresas`, prácticamente todo lo que llaman `MedifoliosApiService` y
`WorldOfficeService`) sin proxear — esas peticiones caían al fallback de SPA del dev-server, que
devuelve el `index.html` de Angular con status 200. El síntoma en el navegador: la pestaña Network
mostraba un 200 "exitoso", pero el cuerpo era HTML, no JSON, así que la consulta parecía traer datos
cuando en realidad nunca llegó a Medifolios/World Office.

**La prueba de humo que se corrió cuando se introdujo el bug (sección anterior de este documento)
no lo detectó** porque solo probó `/api/auth` y `/wo/documentos` — ambas de un segmento, las únicas
que sí funcionaban. Lección: al probar un proxy, probar con una ruta real con dos o más segmentos,
no solo la ruta más corta que exista.

**Arreglo:** `/api/**` y `/wo/**` (doble estrella: sí cruza `/`, sigue exigiendo el `/` después del
prefijo así que `/world-office` sigue sin matchear). Verificado con los tres casos a la vez:
`/api/citas/listar` y `/wo/empresas/listarEmpresas` (multi-segmento) llegan ahora al backend real
(401 sin token válido, no HTML), `/api/auth` y `/wo/documentos` (un segmento) siguen igual, y
`/world-office` sigue sirviendo la SPA. `vercel.json` no tenía este problema: usa la sintaxis de
Vercel `:ruta*`, que es otro motor de matching y sí soporta multi-segmento de por sí.

Notas de `vercel.json` (diferencias con el de `LILIAN/vercel.json` del index.html original):
- **Fallback SPA** `/(.*)` → `/index.html`, en último lugar: el original no lo necesitaba porque era
  una sola página; Angular tiene rutas reales (`/conciliar`, `/world-office`…) que sin esto darían
  404 al recargar. Vercel aplica el primer rewrite que coincide, así que `/api` y `/wo` van antes.
- **`outputDirectory: dist/rehabilitar-angular/browser`** — el builder `@angular/build:application`
  deja los archivos estáticos un nivel más abajo que el builder antiguo.
- Se quitaron las reglas de caché de `/` y `/world-office.js`: ese archivo no existe en el build de
  Angular, y los chunks JS/CSS llevan hash en el nombre (`outputHashing: all`), así que solo
  `index.html` necesita `must-revalidate`.

## Decisiones tomadas sin preguntar (ajustables)

- **Standalone components + signals**, sin NgModules ni NgRx — el patrón del `state` global
  original mapea bien a un servicio de signals, y la app no tiene la complejidad que justificaría
  una librería de estado aparte.
- **CSS plano** replicando las variables/clases del original (`src/styles.css`), no Tailwind ni
  Angular Material — para mantener continuidad visual exacta mientras se migra.
- **Carpeta separada dentro de `LILIAN/`** (`/Users/josemanuelcuello/Desktop/LILIAN/rehabilitar-angular`):
  al principio se creó fuera de `LILIAN/` para no mezclarla con el proyecto en producción, pero el
  usuario la movió de vuelta dentro (2026-10-07). `index.html`/`vercel.json`/`CLAUDE.md` siguen en
  la raíz de `LILIAN/`, como archivos hermanos de esta carpeta — no se tocan ni se referencian desde
  aquí, así que la ubicación relativa no afecta nada del código.
