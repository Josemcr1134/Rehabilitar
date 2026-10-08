import { TestBed } from '@angular/core/testing';
import { AppStateService } from './app-state.service';
import { ConciliarOrchestratorService } from './conciliar-orchestrator.service';
import { ExcelExportService } from './excel-export.service';
import { FileLoaderService } from './file-loader.service';

/**
 * Prueba de humo end-to-end: carga datos sintéticos (equivalentes a subir los
 * tres .xlsx), concilia y exporta el Excel real con ExcelJS. No verifica cifras
 * exactas — confirma que el pipeline completo (core/utils → servicios →
 * ExcelExportService) corre sin lanzar excepciones, con los mismos datos que
 * usaría la app de verdad.
 */
describe('Integración: Conciliar + Exportar Excel', () => {
  it('corre todo el pipeline sin errores y produce un .xlsx no vacío', async () => {
    TestBed.configureTestingModule({});
    const appState = TestBed.inject(AppStateService);
    const fileLoader = TestBed.inject(FileLoaderService);
    const orquestador = TestBed.inject(ConciliarOrchestratorService);
    const excelExport = TestBed.inject(ExcelExportService);

    // --- AGENDA ---
    fileLoader.normalizarYGuardar(
      'AGENDA',
      ['PACIENTE', 'ID. PACIENTE', 'FECHA ASIGNADA', 'EMPRESA CLIENTE', 'REFERENCIA', 'PROFESIONAL'],
      [
        { PACIENTE: 'JUAN  PEREZ GOMEZ', 'ID. PACIENTE': '123456', 'FECHA ASIGNADA': '2026-08-01', 'EMPRESA CLIENTE': 'PARTICULAR', REFERENCIA: 'FISIOTERAPIA PART 32.000', PROFESIONAL: 'MARIA LOPEZ' },
        { PACIENTE: 'ANA  TORRES DIAZ', 'ID. PACIENTE': '999888', 'FECHA ASIGNADA': '2026-08-02', 'EMPRESA CLIENTE': 'COOMEVA', REFERENCIA: 'FONOAUDIOLOGIA TAR 40.000 PAC 20.000 ENT 20.000', PROFESIONAL: 'CARLOS RUIZ' },
      ],
      'Excel',
      { nombre: 'agenda.xlsx', hoja: 'Hoja1', filaEnc: 1, headers: ['PACIENTE', 'ID. PACIENTE', 'FECHA ASIGNADA', 'EMPRESA CLIENTE', 'REFERENCIA', 'PROFESIONAL'],
        matriz: [['PACIENTE', 'ID. PACIENTE', 'FECHA ASIGNADA', 'EMPRESA CLIENTE', 'REFERENCIA', 'PROFESIONAL'],
          ['JUAN  PEREZ GOMEZ', '123456', '2026-08-01', 'PARTICULAR', 'FISIOTERAPIA PART 32.000', 'MARIA LOPEZ'],
          ['ANA  TORRES DIAZ', '999888', '2026-08-02', 'COOMEVA', 'FONOAUDIOLOGIA TAR 40.000 PAC 20.000 ENT 20.000', 'CARLOS RUIZ']],
        objetos: [] },
    );

    // --- CAJA ---
    fileLoader.normalizarYGuardar(
      'CAJA',
      ['NOM TERCERO', 'ID. TERCERO', 'NUM. DOCUMENTO', 'FORMA PAGO', 'ITEMS', 'ENTIDAD', 'FECHA', 'ESTADO', 'VALOR', 'PROFESIONAL/VENDEDOR'],
      [
        { 'NOM TERCERO': 'JUAN  PEREZ GOMEZ', 'ID. TERCERO': '123456', 'NUM. DOCUMENTO': 'COPG-1', 'FORMA PAGO': 'EFECTIVO', ITEMS: 'FISIOTERAPIA PART 32.000', ENTIDAD: 'PARTICULAR', FECHA: '2026-08-01', ESTADO: 'F', VALOR: 32000, 'PROFESIONAL/VENDEDOR': 'MARIA LOPEZ' },
        { 'NOM TERCERO': 'ANA  TORRES DIAZ', 'ID. TERCERO': '999888', 'NUM. DOCUMENTO': 'COPG-2', 'FORMA PAGO': 'TARJETA', ITEMS: 'FONOAUDIOLOGIA TAR 40.000 PAC 20.000 ENT 20.000', ENTIDAD: 'COOMEVA', FECHA: '2026-08-02', ESTADO: 'F', VALOR: 20000, 'PROFESIONAL/VENDEDOR': 'CARLOS RUIZ' },
        { 'NOM TERCERO': 'EMPRESA NIT SA', 'ID. TERCERO': '900123456', 'NUM. DOCUMENTO': 'RCE-9', 'FORMA PAGO': 'TRANSFERENCIA A DAVIVIENDA', ITEMS: 'ABONO DOCUMENTO R-500', ENTIDAD: 'COOMEVA', FECHA: '2026-08-03', ESTADO: 'F', VALOR: 150000, 'PROFESIONAL/VENDEDOR': '' },
      ],
      'Excel',
      { nombre: 'caja.xlsx', hoja: 'Hoja1', filaEnc: 1,
        headers: ['NOM TERCERO', 'ID. TERCERO', 'NUM. DOCUMENTO', 'FORMA PAGO', 'ITEMS', 'ENTIDAD', 'FECHA', 'ESTADO', 'VALOR', 'PROFESIONAL/VENDEDOR'],
        matriz: [
          ['NOM TERCERO', 'ID. TERCERO', 'NUM. DOCUMENTO', 'FORMA PAGO', 'ITEMS', 'ENTIDAD', 'FECHA', 'ESTADO', 'VALOR', 'PROFESIONAL/VENDEDOR'],
          ['JUAN  PEREZ GOMEZ', '123456', 'COPG-1', 'EFECTIVO', 'FISIOTERAPIA PART 32.000', 'PARTICULAR', '2026-08-01', 'F', 32000, 'MARIA LOPEZ'],
          ['ANA  TORRES DIAZ', '999888', 'COPG-2', 'TARJETA', 'FONOAUDIOLOGIA TAR 40.000 PAC 20.000 ENT 20.000', 'COOMEVA', '2026-08-02', 'F', 20000, 'CARLOS RUIZ'],
          ['EMPRESA NIT SA', '900123456', 'RCE-9', 'TRANSFERENCIA A DAVIVIENDA', 'ABONO DOCUMENTO R-500', 'COOMEVA', '2026-08-03', 'F', 150000, ''],
        ],
        objetos: [] },
    );

    // --- CONSUMO ---
    fileLoader.normalizarYGuardar(
      'CONSUMO',
      ['NOM PACIENTE', 'ID PACIENTE', 'FECHA', 'DESCRIPCION', 'MEDICO'],
      [
        { 'NOM PACIENTE': 'JUAN PEREZ GOMEZ', 'ID PACIENTE': '123456', FECHA: '2026-08-01', DESCRIPCION: 'FISIOTERAPIA PART 32.000', MEDICO: 'MARIA LOPEZ' },
        { 'NOM PACIENTE': 'ANA TORRES DIAZ', 'ID PACIENTE': '999888', FECHA: '2026-08-02', DESCRIPCION: 'FONOAUDIOLOGIA TAR 40.000 PAC 20.000 ENT 20.000', MEDICO: 'CARLOS RUIZ' },
      ],
      'Excel',
      { nombre: 'consumo.xlsx', hoja: 'Hoja1', filaEnc: 1, headers: ['NOM PACIENTE', 'ID PACIENTE', 'FECHA', 'DESCRIPCION', 'MEDICO'],
        matriz: [['NOM PACIENTE', 'ID PACIENTE', 'FECHA', 'DESCRIPCION', 'MEDICO'],
          ['JUAN PEREZ GOMEZ', '123456', '2026-08-01', 'FISIOTERAPIA PART 32.000', 'MARIA LOPEZ'],
          ['ANA TORRES DIAZ', '999888', '2026-08-02', 'FONOAUDIOLOGIA TAR 40.000 PAC 20.000 ENT 20.000', 'CARLOS RUIZ']],
        objetos: [] },
    );

    expect(appState.listoParaConciliar()).toBe(true);

    orquestador.ejecutar();

    expect(appState.conciliado()).toBe(true);
    const resultado = appState.resultado()!;
    expect(resultado.analisisCaja.length).toBe(3);
    expect(resultado.servicios.length).toBeGreaterThan(0);
    // El tercero con NIT (900123456) con ítem "ABONO DOCUMENTO..." debe quedar
    // fuera del cruce de conciliación (es un movimiento de entidad).
    expect(appState.groups().some((g) => g.id === '900123456')).toBe(false);

    let bufferSize = 0;
    const originalWriteBuffer = Blob.prototype as any;
    // Interceptamos la descarga (createObjectURL/appendChild no existen igual en jsdom) armando
    // un Blob real y leyendo su tamaño, que es lo que nos interesa confirmar.
    const blobs: Blob[] = [];
    const BlobCtor = globalThis.Blob;
    (globalThis as any).Blob = class extends BlobCtor {
      constructor(parts: any[], opts: any) { super(parts, opts); blobs.push(this as any); }
    };
    try {
      await excelExport.generar('2026-08-01', '2026-08-03');
    } finally {
      (globalThis as any).Blob = BlobCtor;
    }
    expect(blobs.length).toBeGreaterThan(0);
    bufferSize = blobs[0].size;
    expect(bufferSize).toBeGreaterThan(1000); // un .xlsx real nunca pesa unos pocos bytes
  });
});
