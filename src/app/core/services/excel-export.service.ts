import { Injectable, inject } from '@angular/core';
import ExcelJS from 'exceljs';
import { ORDEN_GRUPOS, REGLAS_DOC } from '../models/clasificacion.model';
import { AnalisisCajaRow, CajaTot, OrigenTarifas, PuenteAgenda, ResultadoConciliacion } from '../models/conciliacion-resultado.model';
import { findCol, toNumber } from '../utils/normalizacion.util';
import { descargar } from '../utils/descargar.util';
import { AppStateService } from './app-state.service';
import { ConciliarOrchestratorService } from './conciliar-orchestrator.service';

const AZUL = 'FF005078', ROJO_BG = 'FFFFC7CE', BLANCO = 'FFFFFFFF';
const MONEDA = '#,##0';
const VERDE_BG = 'FFE6F4E6';
const NARANJA = 'FFC55A11';
const NOTA = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF808080' } };

function encabezar(ws: ExcelJS.Worksheet, headers: unknown[]): ExcelJS.Row {
  const row = ws.addRow(headers);
  row.eachCell((c) => {
    c.font = { name: 'Arial', bold: true, color: { argb: BLANCO } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 28;
  return row;
}

/** Fila con [tipo 't'|'s', etiqueta, valor, nota] — igual al array literal del original. */
type FilaResumen = ['t' | 's', string, number, string];

/**
 * «botón ⬇ Descargar Excel (formato MODELO1)» del index.html original. Migrado
 * 1:1: mismas 9 hojas, mismos anchos de columna, mismos colores y el mismo
 * orden de construcción. Lee todo desde AppStateService (equivalente al
 * objeto global `state` del original).
 */
@Injectable({ providedIn: 'root' })
export class ExcelExportService {
  private readonly appState = inject(AppStateService);
  private readonly orquestador = inject(ConciliarOrchestratorService);

  async generar(desde: string, hasta: string): Promise<void> {
    const resultado = this.appState.resultado();
    const O = this.appState.origenTar();
    if (!resultado || !O) throw new Error('Concilia primero antes de exportar.');
    const P = this.orquestador.puente()!;
    const ct = resultado.cajaTot;
    const periodo = `${desde || '—'} a ${hasta || '—'}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Conciliación Rehabilitar';

    this.hojaResumen(wb, O, P, periodo);
    this.hojaPorServicio(wb);
    this.hojaResumenCaja(wb, ct, resultado, periodo);
    this.hojaAnalisisCaja(wb, resultado.analisisCaja);
    this.hojasOriginales(wb, O);
    this.hoja3Archivos(wb, O);
    this.hojaTarifario(wb, O);

    // Fuente Arial en todo el libro
    wb.eachSheet((ws) => { ws.eachRow((row) => { row.eachCell((c) => { c.font = { name: 'Arial', size: 10, ...(c.font || {}) }; }); }); });

    const buf = await wb.xlsx.writeBuffer();
    descargar(new Blob([buf], { type: 'application/octet-stream' }), `Conciliacion_Rehabilitar_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ---------------- HOJA 1: RESUMEN ----------------
  private hojaResumen(wb: ExcelJS.Workbook, O: OrigenTarifas, P: PuenteAgenda, periodo: string) {
    const wsRes = wb.addWorksheet('Resumen');
    wsRes.addRow(['CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S.']);
    wsRes.addRow(['Conciliación AGENDA / CAJA / CONSUMO']);
    wsRes.addRow(['Período', periodo]);
    wsRes.addRow([]);
    wsRes.getCell('A1').font = { name: 'Arial', bold: true, size: 13 };
    wsRes.getCell('A2').font = { name: 'Arial', italic: true };
    wsRes.columns = [{ width: 46 }, { width: 20 }, { width: 52 }];

    encabezar(wsRes, ['INGRESOS POR VENTA DE REPORTE DE AGENDA', 'COP', 'OBSERVACIÓN']);
    const filas: FilaResumen[] = [
      ['t', 'TOTAL VENTA', P!.totalVenta, 'ASUME PACIENTE + ASUME ENTIDAD'],
      ['t', 'TOTAL SESIONES', P!.sesiones, 'Citas del reporte de agenda'],
      ['t', 'ASUME PACIENTE', P!.pac, ''],
      ['s', '   FACTURADO CON RECAUDO — PAGO DEL DIA', P!.pagoDelDia, 'FACTURADO · SI PAGADO O SI RECAUDO. Caja: documentos COPG, COPL, R y RCL-A en efectivo, tarjeta o transferencia (Bancolombia Lilian/Rehabilitar y Davivienda).'],
      ['s', '   FACTURADO SIN RECAUDO — ANTICIPO DESCUENTO', P!.anticipoDescuento, 'FACTURADO · NO PAGADO O NO RECAUDO'],
      ['s', '   NO FACTURADO ASUME PACIENTE — CREDITO DEUDA', P!.credito, 'NO FACTURADO · el paciente queda debiendo'],
      ['s', '   DIFERENCIA NO CONCILIADA', P!.difNoConciliada, 'NO CONCILIADO · agenda menos las tres líneas anteriores. Negativo = se facturó o recaudó más de lo agendado.'],
      ['t', 'ASUME ENTIDAD', P!.ent, ''],
      ['s', '   FACTURADO A ENTIDAD', P!.facturadoEntidad, 'Consumo: VLR. NETO de los servicios ya facturados (ESTATUS = F) en convenio — lo que se le carga a la aseguradora.'],
      ['s', '   NO FACTURADO ASUME ENTIDAD', P!.noFacturadoEntidad, 'PENDIENTE POR FACTURAR'],
    ];
    filas.forEach(([tipo, lab, val, nota]) => {
      const r = wsRes.addRow([lab, val, nota]);
      r.getCell(2).numFmt = MONEDA;
      if (tipo === 't') { r.getCell(1).font = { name: 'Arial', bold: true }; r.getCell(2).font = { name: 'Arial', bold: true }; }
      r.getCell(3).font = NOTA;
      r.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    });

    wsRes.addRow([]);
    encabezar(wsRes, ['FINANCIERO — RECAUDO POR FORMA DE PAGO (ARCHIVO DE CAJA)', 'COP', '']);
    O.formasPago.forEach((f) => { const r = wsRes.addRow([f.forma, f.valor]); r.getCell(2).numFmt = MONEDA; });
    const rTot = wsRes.addRow(['Total general', O.totalCaja]);
    rTot.getCell(2).numFmt = MONEDA;
    rTot.getCell(1).font = { name: 'Arial', bold: true }; rTot.getCell(2).font = { name: 'Arial', bold: true };
    ([
      ['RECAUDO DE AGENDA', P!.recaudoAgenda, 'Valor de los servicios agendados (tarifa total de la agenda)'],
      ['RECAUDO REAL', P!.recaudoReal, 'Efectivo + tarjeta + transferencias Bancolombia y Davivienda (Lilian y Rehabilitar). No incluye anticipo descuento, crédito deuda, ajuste de cartera ni transferencias facturación.'],
    ] as [string, number, string][]).forEach(([lab, val, nota]) => {
      const r = wsRes.addRow([lab, val, nota]);
      r.getCell(2).numFmt = MONEDA;
      r.getCell(1).font = { name: 'Arial', bold: true }; r.getCell(2).font = { name: 'Arial', bold: true };
      r.getCell(3).font = NOTA; r.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    });

    wsRes.addRow([]);
    encabezar(wsRes, ['DESGLOSE TARIFARIO (BASE: AGENDA)', 'COP', '']);
    ([['Tarifa total (TAR)', O.agenda.tar], ['Paga paciente (PAC)', O.agenda.pac], ['Paga entidad (ENT)', O.agenda.ent]] as [string, number][])
      .forEach((f) => { const r = wsRes.addRow(f); r.getCell(2).numFmt = MONEDA; });
    wsRes.addRow(['TAR = PAC + ENT', Math.abs(O.agenda.tar - (O.agenda.pac + O.agenda.ent)) < 1 ? 'CUADRA' : 'NO CUADRA']);
    wsRes.addRow(['Citas con tarifa detectada', `${O.agenda.detectadas} de ${O.agenda.sesiones}`]);

    wsRes.addRow([]);
    wsRes.addRow(['DEFINICIONES USADAS']).getCell(1).font = { name: 'Arial', bold: true };
    ([
      ['Ingresos por venta (agenda)', 'Puente entre lo vendido en la agenda y lo recaudado en caja. TOTAL VENTA, ASUME PACIENTE, ASUME ENTIDAD y TOTAL SESIONES salen de la hoja Agenda (original). PAGO DEL DIA: hoja Caja (original), documentos con prefijo COPG, COPL, R y RCL-A, forma de pago EFECTIVO, TARJETA o transferencia (Bancolombia Lilian, Bancolombia Rehabilitar, Davivienda). Los prefijos ya dejan fuera la cartera de las aseguradoras (RCE, RCEL, LA). ANTICIPO DESCUENTO y CREDITO DEUDA: suma por FORMA PAGO del archivo de caja; el crédito deuda va como NO FACTURADO porque el paciente queda debiendo. DIFERENCIA NO CONCILIADA: agenda menos las tres líneas.'],
      ['Financiero', 'Tabla dinámica de la hoja Caja (original): suma de VALOR agrupada por FORMA PAGO, con los nombres tal como los reporta el archivo. Las formas que suman $0 (ANTICIPO COPAGO / CUOTA MODERADORA, SIN VALOR) son marcas de control, no recaudo.'],
      ['Desglose tarifario', 'Se calcula sobre la hoja Agenda (original): suma de VALOR TARIFA / ASUME PACIENTE / ASUME ENTIDAD de las citas agendadas. Es el valor de los servicios PROGRAMADOS.'],
      ['Tarifa desde el texto', 'La tarifa no está en ninguna tabla aparte: viene escrita dentro del nombre del servicio. Patrones: «TAR 40.900 PAC 20.000 ENT 20.900» (convenio); «PACIENTE 25.000 ENTIDAD 0» (convenio particular); «PART 32.000» (particular: el paciente asume todo, PAC = tarifa y ENT = 0); «PAC 0 ENT 39.240» (sin TAR: la tarifa es la suma). «ABONO DOCUMENTO ...» no describe un servicio y queda sin tarifa.'],
      ['Renglones con varios servicios', 'Un renglón de CAJA puede traer varios servicios separados por " | ". La tarifa unitaria solo se llena si todos los ítems valen lo mismo; si no, queda vacía y se reportan TARIFA TOTAL ITEMS / PACIENTE TOTAL ITEMS / ENTIDAD TOTAL ITEMS.'],
      ['Movimientos de entidad', 'Abonos de aseguradoras contra su cartera (tercero con NIT o ítem "ABONO DOCUMENTO"). No son recaudo del día ni corresponden a un servicio, por eso quedan fuera del cruce.'],
      ['Hoja TARIFARIO', 'Catálogo de los servicios distintos que aparecen en los tres archivos, con su VALOR TARIFA / ASUME PACIENTE / ASUME ENTIDAD y en cuántos renglones aparece cada uno.'],
      ['Hoja analisis_caja', 'Tabla plana, un renglón por movimiento, con el encabezado en la fila 1 y el panel congelado en la fila 1 y las dos primeras columnas. Los totales están aparte, en la hoja resumen_caja.'],
      ['Matriz de caja', 'Cada movimiento se clasifica por el prefijo del NUM. DOCUMENTO y su forma de pago: COPG y COPL (7 formas) = ASUME PACIENTE; R (9 formas) = ASUME PACIENTE si el tercero tiene cédula o RADICADO A ENTIDAD si es NIT/empresa; RCR-A y RCL-A (7 formas) = ASUME PACIENTE solo con valor 0, si no PAGO DE DEUDA; ANTL y ANTR (5 formas) = ANTICIPO RECIBIDO; RCE (2 formas) = PAGO DE DEUDA; LA (2 formas) = RADICADO A ENTIDAD.'],
      ['¿Entra en la agenda del día?', 'Marca si el documento debe cruzarse contra la agenda. No entran: ANTL, ANTR, RCE, LA y las RCL-A con valor distinto de 0.'],
      ['¿Forma permitida?', 'NO cuando la forma de pago del movimiento no está en la lista cerrada que la matriz autoriza para ese prefijo.'],
      ['Hojas (original)', 'Copia literal de los tres archivos de origen más las columnas de tarifa derivadas del texto, para auditar cualquier cifra sin salir del libro.'],
    ] as [string, string][]).forEach((f) => { const r = wsRes.addRow(f); r.getCell(2).alignment = { wrapText: true }; });
  }

  // ---------------- HOJA 2: POR SERVICIO ----------------
  private hojaPorServicio(wb: ExcelJS.Workbook) {
    const servicios = this.appState.resultado()!.servicios;
    const wsSer = wb.addWorksheet('Por servicio');
    wsSer.columns = [{ width: 30 }, { width: 72 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 20 }, { width: 46 }];
    encabezar(wsSer, ['Paciente', 'Servicio', 'AG', 'CJ', 'CO', 'Estado', 'Validación']);
    servicios.forEach((s) => {
      const row = wsSer.addRow([s.nombre, s.servicio, s.ag, s.cj, s.co, s.estado, s.notaAprobado || '']);
      if (s.estado !== 'Conciliado') {
        row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
        row.getCell(6).font = { name: 'Arial', bold: true, color: { argb: 'FF9C0006' } };
      }
      if (s.aprobado) {
        row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_BG } };
        row.getCell(7).font = { name: 'Arial', bold: true, color: { argb: 'FF1B6B1B' } };
      }
    });
    wsSer.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
    wsSer.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // ---------------- HOJA 3: RESUMEN_CAJA ----------------
  private hojaResumenCaja(wb: ExcelJS.Workbook, ct: CajaTot, resultado: ResultadoConciliacion, periodo: string) {
    const wsRc = wb.addWorksheet('resumen_caja');
    wsRc.columns = [{ width: 52 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 64 }];
    wsRc.addRow(['ANÁLISIS DEL ARCHIVO DE CAJA — MATRIZ PREFIJO × FORMA DE PAGO']).getCell(1).font = { name: 'Arial', bold: true, size: 12 };
    wsRc.addRow(['Período', periodo]);
    wsRc.addRow([]);

    encabezar(wsRc, ['CONCEPTO', 'VALOR (COP)']);
    ([
      ['Movimientos en el archivo', ct.movimientos],
      ['Documentos únicos', ct.documentos],
      ['Movimientos que ENTRAN en la agenda del día', ct.entranAgenda],
      ['Movimientos que NO entran en la agenda del día', ct.noEntranAgenda],
      ['— — —', ''],
      ['RECAUDO EFECTIVO DEL DÍA', ct.recaudoDia],
      ['   · grupo ASUME PACIENTE', ct.recaudoPaciente],
      ['   · grupo PAGO DE DEUDA (cartera)', ct.recaudoCartera],
      ['   · grupo ANTICIPO RECIBIDO (ANTL / ANTR)', ct.recaudoAnticipos],
      ['— — —', ''],
      ['Dinero contemplado en OTRA vía de recaudo', ct.anticipos + ct.creditos],
      ['   · anticipos aplicados (ya cobrados en ANTL/ANTR)', ct.anticipos],
      ['   · créditos por cobrar (se recaudan vía RCE)', ct.creditos],
      ['   · ajustes de cartera (no mueven caja)', ct.ajustes],
      ['Radicado a entidad (R con NIT y LA)', ct.radicado],
      ['Movimientos SIN VALOR (los asume la entidad al 100%)', ct.sinValor],
      ['Movimientos anulados', ct.anulados],
      ['— — —', ''],
      ['Total movido en caja', ct.totalMovido],
      ['Formas de pago fuera de la matriz', ct.formaInvalida],
      ['Movimientos con inconsistencia', ct.conInconsistencia],
    ] as [string, number | string][]).forEach((f) => {
      const row = wsRc.addRow(f);
      if (typeof f[1] === 'number' && !/movimientos|documentos|inconsistencia|matriz|anulados|entran/i.test(f[0])) row.getCell(2).numFmt = MONEDA;
      if (/RECAUDO EFECTIVO|Total movido/.test(f[0])) row.font = { name: 'Arial', bold: true };
      if (/inconsistencia|fuera de la matriz/i.test(f[0]) && Number(f[1]) > 0) {
        row.getCell(2).font = { name: 'Arial', bold: true, color: { argb: 'FF9C0006' } };
        row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
      }
    });

    wsRc.addRow([]);
    encabezar(wsRc, ['GRUPO DE LA MATRIZ', 'MOVIMIENTOS', 'VALOR', 'RECAUDO HOY', 'ENTRAN EN AGENDA']);
    ORDEN_GRUPOS.filter((g) => resultado.porGrupo[g]).forEach((g) => {
      const v = resultado.porGrupo[g];
      const row = wsRc.addRow([g, v.n, v.valor, v.recaudo, v.agenda]);
      row.getCell(1).font = { name: 'Arial', bold: true };
      row.getCell(3).numFmt = MONEDA; row.getCell(4).numFmt = MONEDA;
    });

    wsRc.addRow([]);
    encabezar(wsRc, ['STATUS', 'MOVIMIENTOS', 'VALOR', 'RECAUDO HOY']);
    Object.entries(resultado.porStatus).sort(([a], [b]) => a.localeCompare(b)).forEach(([st, v]) => {
      const row = wsRc.addRow([st, v.n, v.valor, v.recaudo]);
      row.getCell(3).numFmt = MONEDA; row.getCell(4).numFmt = MONEDA;
    });

    wsRc.addRow([]);
    encabezar(wsRc, ['PREFIJO', 'MOVIMIENTOS', 'VALOR', 'RECAUDO HOY', 'FUERA DE MATRIZ', 'FORMAS DE PAGO ENCONTRADAS']);
    Object.entries(resultado.matrizPref).sort(([a], [b]) => a.localeCompare(b)).forEach(([pr, v]) => {
      const det = Object.entries(v.formas).sort(([a], [b]) => a.localeCompare(b)).map(([f, d]) => `${f} (${d.n})`).join(' · ');
      const row = wsRc.addRow([pr, v.n, v.valor, v.recaudo, v.invalidas, det]);
      row.getCell(1).font = { name: 'Arial', bold: true };
      row.getCell(3).numFmt = MONEDA; row.getCell(4).numFmt = MONEDA;
      row.getCell(6).alignment = { wrapText: true };
      if (v.invalidas) {
        row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
        row.getCell(5).font = { name: 'Arial', bold: true, color: { argb: 'FF9C0006' } };
      }
    });

    wsRc.addRow([]);
    wsRc.addRow(['MATRIZ DE REGLAS APLICADA']).getCell(1).font = { name: 'Arial', bold: true };
    encabezar(wsRc, ['PREFIJO', 'TIPO DE DOCUMENTO', 'GRUPO', '¿ENTRA EN AGENDA?', 'FORMAS PERMITIDAS', 'CLÁUSULA']);
    const ETIQUETA_GRUPO: Record<string, string> = { MIXTO_TERCERO: 'ASUME PACIENTE o RADICADO A ENTIDAD', MIXTO_VALOR: 'ASUME PACIENTE (valor 0) o PAGO DE DEUDA' };
    Object.entries(REGLAS_DOC).forEach(([pre, r]) => {
      const agenda = r.entraAgenda === true ? 'SI' : r.entraAgenda === false ? 'NO' : 'Solo si el valor es 0';
      const row = wsRc.addRow([pre, r.desc, ETIQUETA_GRUPO[r.grupoBase] || r.grupoBase, agenda, `(${r.formas.length}) ` + r.formas.join(' · '), r.nota || '—']);
      row.getCell(1).font = { name: 'Arial', bold: true };
      [5, 6].forEach((c) => { row.getCell(c).alignment = { wrapText: true }; });
      if (agenda === 'NO') {
        row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CC' } };
        row.getCell(4).font = { name: 'Arial', bold: true, color: { argb: 'FF7A5C00' } };
      }
    });
    wsRc.views = [{ state: 'frozen', ySplit: 3 }];
  }

  // ---------------- HOJA 4: ANALISIS_CAJA ----------------
  private hojaAnalisisCaja(wb: ExcelJS.Workbook, analisisCaja: AnalisisCajaRow[]) {
    const wsCaj = wb.addWorksheet('analisis_caja');
    const COLS_CAJA: [string, number][] = [
      ['NUM. DOCUMENTO', 16], ['NOM TERCERO', 30], ['PREFIJO', 10], ['TIPO DE DOCUMENTO', 26],
      ['GRUPO', 22], ['¿ENTRA EN AGENDA DEL DÍA?', 14], ['STATUS', 24], ['FECHA', 12],
      ['ID. TERCERO', 14], ['ENTIDAD', 26], ['FORMA PAGO (ARCHIVO)', 28],
      ['FORMA PAGO (MATRIZ)', 34], ['¿FORMA PERMITIDA?', 12], ['VALOR', 14],
      ['SERVICIO / CONCEPTO', 50], ['TAR', 12], ['PAC', 12], ['ENT', 12], ['TIPO TARIFA', 13],
      ['RECAUDO HOY', 14], ['RESTO', 14], ['DESTINO DEL RESTO', 44], ['CLÁUSULA APLICADA', 48],
      ['INCONSISTENCIAS', 60],
    ];
    const NCOL = COLS_CAJA.length;
    wsCaj.columns = COLS_CAJA.map((c) => ({ width: c[1] }));
    encabezar(wsCaj, COLS_CAJA.map((c) => c[0]));

    const COL_MONEDA = [14, 16, 17, 18, 20, 21];
    analisisCaja.forEach((x) => {
      const row = wsCaj.addRow([
        x.documento, x.nombre, x.prefijo, x.tipoDoc,
        x.grupo, x.entraAgenda, x.status, x.fecha,
        x.id, x.entidad, x.formaPago,
        x.formaNorm, x.formaValida, x.valor,
        x.servicio, x.tar, x.pac, x.ent, x.tipoTarifa,
        x.recaudo, x.resto, x.destino, x.clausula, x.inconsistencias,
      ]);
      COL_MONEDA.forEach((c) => { row.getCell(c).numFmt = MONEDA; });
      [15, 22, 23, 24].forEach((c) => { row.getCell(c).alignment = { wrapText: true, vertical: 'top' }; });
      row.getCell(5).font = { name: 'Arial', bold: true };

      const colorGrupo: Record<string, string> = {
        'ASUME PACIENTE': 'FFE6F4E6', 'RADICADO A ENTIDAD': 'FFE8EEF4', 'PAGO DE DEUDA': 'FFFDEDF5',
        'ANTICIPO RECIBIDO': 'FFFFF6D8', ANULADO: 'FFEDEDED', 'SIN CLASIFICAR': ROJO_BG,
      };
      const cg = colorGrupo[x.grupo];
      if (cg) [3, 4, 5].forEach((c) => { row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cg } }; });

      if (x.entraAgenda === 'NO') {
        row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CC' } };
        row.getCell(6).font = { name: 'Arial', bold: true, color: { argb: 'FF7A5C00' } };
      }
      if (x.formaValida === 'NO') {
        [12, 13].forEach((c) => {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
          row.getCell(c).font = { name: 'Arial', bold: true, color: { argb: 'FF9C0006' } };
        });
      }
      if (x.hayRecaudo === 'SI') row.getCell(20).font = { name: 'Arial', bold: true, color: { argb: 'FF1B6B1B' } };
      if (x.inconsistencias) {
        row.getCell(NCOL).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
        row.getCell(NCOL).font = { name: 'Arial', bold: true, color: { argb: 'FF9C0006' } };
      }
    });

    const ultimaFilaCaja = wsCaj.rowCount;
    wsCaj.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ultimaFilaCaja), column: NCOL } };
    wsCaj.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2', activeCell: 'C2', showGridLines: true, zoomScale: 90 }];
    wsCaj.getRow(1).height = 32;
    wsCaj.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  }

  // ---------------- HOJAS FINALES: LOS TRES ARCHIVOS DE ORIGEN ----------------
  private hojasOriginales(wb: ExcelJS.Workbook, O: OrigenTarifas) {
    const raw = this.appState.raw();
    (['AGENDA', 'CAJA', 'CONSUMO'] as const).forEach((tipo) => {
      const titulo = tipo === 'AGENDA' ? 'Agenda (original)' : tipo === 'CAJA' ? 'Caja (original)' : 'Consumo (original)';
      const src = raw[tipo];
      const ws = wb.addWorksheet(titulo);
      if (!src || !src.matriz || !src.matriz.length) { ws.addRow([`Sin datos de origen para ${tipo}.`]); return; }
      const info = (O.hojas || {})[tipo];
      const fEnc = info ? info.fEnc : 1;
      const nCols = Math.max(...src.matriz.map((f) => f.length));
      const extra = ['VALOR TARIFA', 'ASUME PACIENTE', 'ASUME ENTIDAD', 'TIPO TARIFA', 'ORIGEN TARIFA (TEXTO)'];
      if (tipo === 'CAJA') extra.push('N° SERVICIOS EN ITEMS', 'TARIFA TOTAL ITEMS', 'PACIENTE TOTAL ITEMS', 'ENTIDAD TOTAL ITEMS');
      if (tipo === 'CONSUMO') extra.push('CHEQUEO VS ARCHIVO');

      const hs = (src.headers && src.headers.length ? src.headers : (src.matriz[fEnc - 1] as string[])) || [];
      const cBruto = findCol(hs, ['VLR. BRUTO', 'VALOR BRUTO']);
      const cCpg = findCol(hs, ['CPG/CM/DSCTS', 'CPG']);
      const cNeto = findCol(hs, ['VLR. NETO', 'VALOR NETO']);

      src.matriz.forEach((fila, n) => {
        const linea = (fila as unknown[]).slice();
        while (linea.length < nCols) linea.push('');
        if (n === fEnc - 1) {
          extra.forEach((h) => linea.push(h));
        } else if (n >= fEnc && info) {
          const t = info.filas[n - fEnc] || ({} as any);
          linea.push(t.tar, t.pac, t.ent, t.tipo || '', t.regla || '');
          if (tipo === 'CAJA') {
            const tt: any = t.total || {};
            linea.push(t.n || 0, tt.tar, tt.pac, tt.ent);
          }
          if (tipo === 'CONSUMO') {
            const b = cBruto >= 0 ? toNumber(fila[cBruto]) : null;
            const p = cCpg >= 0 ? toNumber(fila[cCpg]) : null;
            const e = cNeto >= 0 ? toNumber(fila[cNeto]) : null;
            let msg: string;
            if (t.tar === null || t.tar === undefined) msg = 'SIN TARIFA EN TEXTO';
            else if (t.tar === b && t.pac === p && t.ent === e) msg = 'OK';
            else if (t.tar === b) msg = `TARIFA OK — reparto distinto en archivo (PAC ${p} / ENT ${e})`;
            else msg = `REVISAR — archivo TAR ${b} PAC ${p} ENT ${e}`;
            linea.push(msg);
          }
        } else {
          extra.forEach(() => linea.push(''));
        }
        const row = ws.addRow(linea);
        if (n === fEnc - 1) {
          for (let c = nCols + 1; c <= nCols + extra.length; c++) {
            const cell = row.getCell(c);
            cell.font = { name: 'Arial', bold: true, color: { argb: BLANCO } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NARANJA } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          }
          row.height = 30;
        } else if (n >= fEnc) {
          for (let c = nCols + 1; c <= nCols + 3; c++) row.getCell(c).numFmt = MONEDA;
          if (tipo === 'CAJA') for (let c = nCols + 7; c <= nCols + 9; c++) row.getCell(c).numFmt = MONEDA;
          if (tipo === 'CONSUMO' && /^REVISAR/.test(String(linea[linea.length - 1] || ''))) {
            row.getCell(nCols + extra.length).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
          }
        }
      });
      const anchos: number[] = [];
      src.matriz.slice(0, 60).forEach((fila) => {
        (fila as unknown[]).forEach((v, i) => { anchos[i] = Math.min(52, Math.max(anchos[i] || 10, String(v == null ? '' : v).length + 2)); });
      });
      anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      extra.forEach((_h, i) => { ws.getColumn(nCols + i + 1).width = i < 4 ? 15 : i === 4 ? 30 : 18; });
      ws.getCell('A1').font = { name: 'Arial', bold: true };
      ws.autoFilter = { from: { row: fEnc, column: 1 }, to: { row: fEnc, column: nCols + extra.length } };
      ws.views = [{ state: 'frozen', ySplit: fEnc }];
    });
  }

  // ---------------- HOJA «3 ARCHIVOS» ----------------
  private hoja3Archivos(wb: ExcelJS.Workbook, O: OrigenTarifas) {
    const raw = this.appState.raw();
    const MAPA_3A: [number, string | null, string | null, string | null][] = [
      [2, 'NOM PACIENTE', 'NOM TERCERO', 'PACIENTE'],
      [3, 'ID PACIENTE', 'ID. TERCERO', 'ID. PACIENTE'],
      [4, 'DESCRIPCION', 'ITEMS', 'REFERENCIA'],
      [5, 'EPS', 'ENTIDAD', 'EMPRESA CLIENTE'],
      [6, 'NUM. AUTORIZACION', null, 'NUM. AUTORIZACION'],
      [7, 'MEDICO', null, 'PROFESIONAL'],
      [8, 'FECHA', 'FECHA', 'FECHA ASIGNADA'],
      [9, 'CANTIDAD', 'ESTADO', null],
      [10, 'COD. SERVICIO', 'VALOR', null],
      [11, 'ESTATUS', 'CAJA', 'ESTADO2'],
      [12, 'DOCUMENTO', 'NUM. DOCUMENTO', null],
      [13, 'VLR. BRUTO', 'NO VERIFICACION', null],
      [14, 'CPG/CM/DSCTS', 'TIPO DOCUMENTO', null],
      [15, 'VLR. NETO', 'FORMA PAGO', 'HORA ASIGNADA'],
      [16, 'VALOR TARIFA', 'VALOR TARIFA', 'VALOR TARIFA'],
      [17, 'ASUME PACIENTE', 'ASUME PACIENTE', 'ASUME PACIENTE'],
      [18, 'ASUME ENTIDAD', 'ASUME ENTIDAD', 'ASUME ENTIDAD'],
      [19, 'TIPO TARIFA', 'TIPO TARIFA', 'TIPO TARIFA'],
      [20, 'ORIGEN TARIFA (TEXTO)', 'ORIGEN TARIFA (TEXTO)', 'ORIGEN TARIFA (TEXTO)'],
      [21, 'CHEQUEO VS ARCHIVO', 'N° SERVICIOS EN ITEMS', 'PUNTO ATENCION'],
      [22, null, 'TARIFA TOTAL ITEMS', 'SEDE'],
      [23, null, 'PACIENTE TOTAL ITEMS', 'TIPO CONSULTA'],
      [24, null, 'ENTIDAD TOTAL ITEMS', null],
      [25, null, 'AUTORIZACION', null],
    ];
    const N3A = 25;
    const ws3A = wb.addWorksheet('3 ARCHIVOS');
    [10, 32, 14, 58, 32, 18, 30, 20, 10, 14, 16, 16, 16, 16, 26, 14, 15, 15, 20, 26, 20, 18, 20, 18, 16]
      .forEach((w, i) => { ws3A.getColumn(i + 1).width = w; });

    (['CONSUMO', 'CAJA', 'AGENDA'] as const).forEach((fuente, idx) => {
      const k = (idx + 1) as 1 | 2 | 3; // 1=CONSUMO, 2=CAJA, 3=AGENDA — igual que el original
      const src = raw[fuente];
      const info = (O.hojas || {})[fuente];
      if (!src || !src.matriz || !src.matriz.length || !info) return;
      const fEnc = info.fEnc;
      const hs = (src.headers && src.headers.length ? src.headers : (src.matriz[fEnc - 1] as string[])) || [];
      const col: Record<number, number> = {};
      MAPA_3A.forEach((m) => { const nom = m[k]; if (nom) col[m[0]] = findCol(hs, [nom]); });

      const hdr = new Array(N3A).fill(null);
      hdr[0] = fuente;
      MAPA_3A.forEach((m) => { if (m[k]) hdr[m[0] - 1] = m[k]; });
      const rh = ws3A.addRow(hdr);
      for (let c = 1; c <= N3A; c++) {
        const cell = rh.getCell(c);
        cell.font = { name: 'Arial', bold: true, color: { argb: BLANCO }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c >= 16 && c <= 20 ? 'FFC55A11' : AZUL } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
      rh.height = 30;

      for (let n = fEnc; n < src.matriz.length; n++) {
        const fila = (src.matriz[n] || []) as unknown[];
        const t = (info.filas[n - fEnc] || {}) as any;
        if (fuente === 'CAJA' && (t.tar === null || t.tar === undefined)) continue;
        const linea: unknown[] = new Array(N3A).fill(null);
        linea[0] = fuente;
        MAPA_3A.forEach((m) => {
          const c = m[0], i = col[c];
          if (i === undefined || i < 0) return;
          linea[c - 1] = fila[i] === undefined ? null : fila[i];
        });
        linea[15] = t.tar; linea[16] = t.pac; linea[17] = t.ent;
        linea[18] = t.tipo || ''; linea[19] = t.regla || '';
        if (fuente === 'CAJA') {
          const tt = t.total || {};
          linea[20] = t.n || 0; linea[21] = tt.tar; linea[22] = tt.pac; linea[23] = tt.ent;
        }
        if (fuente === 'CONSUMO') {
          const b = col[13] >= 0 ? toNumber(fila[col[13]]) : null;
          const p = col[14] >= 0 ? toNumber(fila[col[14]]) : null;
          const e = col[15] >= 0 ? toNumber(fila[col[15]]) : null;
          linea[12] = b; linea[13] = p; linea[14] = e;
          if (t.tar === null || t.tar === undefined) linea[20] = 'SIN TARIFA EN TEXTO';
          else if (t.tar === b && t.pac === p && t.ent === e) linea[20] = 'OK';
          else if (t.tar === b) linea[20] = `TARIFA OK — reparto distinto en archivo (PAC ${p} / ENT ${e})`;
          else linea[20] = `REVISAR — archivo TAR ${b} PAC ${p} ENT ${e}`;
        }
        const row = ws3A.addRow(linea);
        [16, 17, 18].forEach((c) => { row.getCell(c).numFmt = MONEDA; });
        if (fuente === 'CAJA') [10, 22, 23, 24].forEach((c) => { row.getCell(c).numFmt = MONEDA; });
        if (fuente === 'CONSUMO') [13, 14, 15].forEach((c) => { row.getCell(c).numFmt = MONEDA; });
      }
    });
    ws3A.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    ws3A.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: N3A } };
  }

  // ---------------- HOJA TARIFARIO ----------------
  private hojaTarifario(wb: ExcelJS.Workbook, O: OrigenTarifas) {
    const wsTar = wb.addWorksheet('TARIFARIO');
    wsTar.columns = [{ width: 80 }, { width: 15 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 24 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 20 }];
    encabezar(wsTar, ['SERVICIO / CONCEPTO (TEXTO ORIGEN)', 'VALOR TARIFA', 'ASUME PACIENTE', 'ASUME ENTIDAD', 'TIPO TARIFA', 'ORIGEN TARIFA (TEXTO)', 'VECES EN AGENDA', 'MENCIONES EN CAJA (ITEMS)', 'VECES EN CONSUMO', 'CUADRA TAR = PAC + ENT']);
    (O.tarifario || []).forEach((c) => {
      const t = c.t || ({} as any);
      const cuadra = t.detectado && Math.abs((t.tar || 0) - ((t.pac || 0) + (t.ent || 0))) < 1 ? 'SI' : 'REVISAR';
      const row = wsTar.addRow([c.servicio, t.tar, t.pac, t.ent, t.tipo || '', t.regla || '', c.ag, c.cj, c.co, cuadra]);
      [2, 3, 4].forEach((i) => { row.getCell(i).numFmt = MONEDA; });
      if (cuadra === 'REVISAR') {
        row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_BG } };
        row.getCell(10).font = { name: 'Arial', bold: true, color: { argb: 'FF9C0006' } };
      }
    });
    wsTar.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
    wsTar.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  }
}
