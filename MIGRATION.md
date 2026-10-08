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

## Cómo correr

```bash
npm install          # ya instalado en este checkout
npm start             # ng serve — usa proxy.conf.json, igual que vercel.json pero en local
npm test              # vitest vía @angular/build:unit-test
npm run build         # build de producción — rutas con loadComponent (lazy) para mantener
                       # exceljs fuera del bundle inicial (budget de 1 MB)
```

`proxy.conf.json` reenvía `/api/*` → Medifolios y `/wo/*` → World Office, mismos destinos que los
dos rewrites de `vercel.json` (los globs con `/*` son necesarios: un contexto bare `"/wo"` hace
match por prefijo y secuestra la ruta Angular `/world-office`). Para producción, el equivalente de
`vercel.json` todavía no se creó en este proyecto (pendiente cuando se decida desplegarlo).

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
