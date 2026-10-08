/**
 * Tipados de todo lo que produce el handler de "Conciliar" en index.html:
 * grupos por paciente, por servicio, por referencia, relación caja↔agenda,
 * análisis de caja y los KPIs agregados. Un solo módulo porque en el original
 * todas estas estructuras se calculan en el mismo recorrido de datos.
 */
import { AgendaRecord, CajaRecord, CategoriaCaja, ConsumoRecord, Tarifa } from './records.model';
import { ComparacionCampo, EstadoConciliacion } from '../utils/comparacion.util';
import { GrupoMatriz } from './clasificacion.model';

// ---------- Por servicio (hoja "Por servicio") ----------
export interface ServicioRow {
  id: string; nombre: string; servicio: string;
  ag: number; cj: number; co: number;
  cajaRecs: CajaRecord[];
  estado: EstadoConciliacion;
  aprobado: boolean; notaAprobado: string;
}

// ---------- REFERENCIAITEMDESCRIPCION (hoja "Tarifas por referencia") ----------
export type EstadoReferencia = 'Sin tarifa detectada' | 'Diferencia' | 'Falta en una fuente' | 'Cuadra';

export interface ReferenciaRow {
  id: string; nombre: string; base: string; fuentes: string;
  ag: Tarifa; cj: Tarifa; co: Tarifa;
  tarOk: 'SI' | 'NO' | 'N/A'; pacOk: 'SI' | 'NO' | 'N/A'; entOk: 'SI' | 'NO' | 'N/A'; sumaOk: 'SI' | 'NO' | 'N/A';
  estado: EstadoReferencia;
}

// ---------- relacion_caja_agenda ----------
export interface RelacionRow {
  id: string; nomAgenda: string; nomCaja: string; nombreIgual: 'SI' | 'NO' | 'N/A';
  citas: number; movimientos: number; documentos: number; dif: number;
  servAgenda: string; servCaja: string; refIgual: 'SI' | 'NO' | 'N/A';
  estado: 'Revisar' | 'OK'; inusualidades: string;
}

export interface RelacionTotales {
  citas: number; movimientos: number; documentos: number; divididas: number;
  pacAgenda: number; pacCaja: number; soloAgenda: number; soloCaja: number;
  aRevisar: number; nombreDistinto: number; refDistinta: number;
}

// ---------- analisis_caja ----------
export interface AnalisisCajaRow {
  bloque: 'PAGO_PACIENTE' | 'PAGO_ENTIDADES';
  grupo: GrupoMatriz; status: string; hayRecaudo: 'SI' | 'NO'; entraAgenda: 'SI' | 'NO';
  documento: string; prefijo: string; tipoDoc: string; fecha: string; id: string; nombre: string;
  entidad: string; formaPago: string; formaNorm: string; formaValida: 'SI' | 'NO' | 'N/D';
  valor: number; servicio: string;
  tar: number | null; pac: number | null; ent: number | null; tipoTarifa: string;
  recaudo: number; resto: number; destino: string; clausula: string; inconsistencias: string;
}

export interface CajaTot {
  movimientos: number; documentos: number; valorPaciente: number; recaudoDia: number;
  recaudoPaciente: number; recaudoCartera: number; recaudoAnticipos: number; radicado: number;
  anticipos: number; creditos: number; ajustes: number; sinValor: number; asumeEntidad: number;
  entranAgenda: number; noEntranAgenda: number; anulados: number; formaInvalida: number;
  totalMovido: number; conInconsistencia: number;
}

export interface PorGrupoEntry { n: number; valor: number; recaudo: number; agenda: number }
export interface PorStatusEntry { n: number; valor: number; recaudo: number }
export interface MatrizPrefEntry {
  n: number; valor: number; recaudo: number; invalidas: number; grupo: string; entraAgenda: string;
  formas: Record<string, { n: number; valor: number; ok: string }>;
}

// ---------- Categorías de caja (cards 7) ----------
export interface CategoriaCajaEntry { count: number; valor: number }

// ---------- KPIs agregados (card 5 / dashboard) ----------
export interface Kpis {
  registrosAgenda: number; registrosCaja: number; registrosConsumo: number; movimientosEntidad: number;
  pacientesAgenda: number; pacientesCaja: number; pacientesConsumo: number;
  gruposConciliados: number; gruposTotales: number; citasConciliadas: number; pctConciliacion: number;
  inconsistencias: number;
  facturacionBruta: number; descuentosCopagos: number; facturacionNeta: number; recaudoCaja: number;
  anticipos: number; transferenciasFacturacion: number; credito: number; anulados: number; anuladosCount: number;
  tarTotal: number; pacTotal: number; entTotal: number; docsTotal: number; docsDetectados: number;
  refTotal: number; refDiferencia: number; refIncompleto: number;
}

// ---------- analizarOrigenTarifas() / puenteAgenda() ----------
export interface TarifarioEntry { servicio: string; t: Tarifa; ag: number; cj: number; co: number }
export interface HojaOrigen { fEnc: number; cServ: number; filas: Tarifa[] }

export interface OrigenTarifas {
  hojas: Partial<Record<'AGENDA' | 'CAJA' | 'CONSUMO', HojaOrigen>>;
  agenda: { tar: number; pac: number; ent: number; sesiones: number; detectadas: number };
  formasPago: { forma: string; valor: number }[];
  totalCaja: number;
  pagoDelDia: number; pagoDelDiaMov: number; pagoDelDiaPorPrefijo: Record<string, number>;
  conNit: number; conNitMov: number;
  credito: number; anticipoDescuento: number; recaudoReal: number;
  radicadoEntidad: number; facturadoEntidadConsumo: number; tarifario: TarifarioEntry[];
}

export interface PuenteAgenda {
  totalVenta: number; sesiones: number; pac: number; ent: number;
  pagoDelDia: number; anticipoDescuento: number; credito: number; difNoConciliada: number;
  recaudoAgenda: number; recaudoReal: number; difRecaudo: number;
  facturadoEntidad: number; noFacturadoEntidad: number;
}

/** Resultado completo del handler de "Conciliar" — se guarda entero en AppStateService. */
export interface ResultadoConciliacion {
  servicios: ServicioRow[];
  referencias: ReferenciaRow[];
  relacion: RelacionRow[];
  relTot: RelacionTotales;
  analisisCaja: AnalisisCajaRow[];
  cajaTot: CajaTot;
  porGrupo: Record<string, PorGrupoEntry>;
  porStatus: Record<string, PorStatusEntry>;
  matrizPref: Record<string, MatrizPrefEntry>;
  cats: Record<CategoriaCaja, CategoriaCajaEntry>;
  kpis: Kpis;
}
