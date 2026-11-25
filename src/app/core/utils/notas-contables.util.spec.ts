import { AgendaRecord, CajaRecord } from '../models/records.model';
import { esCitaLilian, formaNoEsDelPaciente, notasDesdeAgenda, notasDesdeCaja, servicioNota, siguientesPorDefecto, valoresReferencia } from './notas-contables.util';
import { notaCuadrada } from './world-office-notas.util';

const cita = (o: Partial<AgendaRecord>): AgendaRecord => ({
  nombre: 'ANA PEREZ', id: '111', fecha: '2026-06-01', eps: 'SEGUROS DE VIDA SURAMERICANA SA POLIZA 2024', referencia: '', autorizacion: '',
  profesional: '', estado: 'CUMPLIDA', estado2: '', hora: '', sede: 'CONSULTORIO', tipoConsulta: '', ...o,
});
const mov = (o: Partial<CajaRecord>): CajaRecord => ({
  nombre: 'ANA  PEREZ', id: '111', documento: 'R-10', formaPago: 'EFECTIVO', items: '', itemsRaw: '', entidad: 'PARTICULARES', autorizacion: '',
  profesional: '', fecha: '2026-05-04', estado: 'F', valor: 30000, caja: '', agendaTipo: '', sede: '', cotizante: '', regimen: '', detalleProf: '',
  noVerificacion: '', tipoDocumento: '', fechaRegistro: '', quienRegistra: '', servicioFecha: '', categoria: 'PAGO_NORMAL', esEntidad: false,
  tarifa: null as any, ...o,
});

describe('notas contables — reglas', () => {
  it('lee los valores de la referencia de la agenda', () => {
    expect(valoresReferencia('CONSULTA ... FISIOTERAPIA 2025 ALLIANZ TAR 38.900 PAC 19.000 ENT 19.900')).toEqual({ paciente: 19000, entidad: 19900, encontrado: true });
    expect(valoresReferencia('CONSULTA ... PSICOLOGIA PART 80.000')).toEqual({ paciente: 80000, entidad: 0, encontrado: true });
    expect(valoresReferencia('CONSULTA FISIOTERAPIA CORTESIA')).toEqual({ paciente: 0, entidad: 0, encontrado: true });
    expect(valoresReferencia('CONSULTA FISIOTERAPIA').encontrado).toBe(false);
  });

  it('servicios, Lilian y formas de pago que no son del paciente', () => {
    expect(servicioNota('CONSULTA ... POR NEURODINAMIA PART 70.000')).toBe('FISIOTERAPIA');
    expect(servicioNota('PRUEBA NEUROSICOLOGICA COLMEDICA')).toBe('PSICOLOGIA');
    expect(servicioNota('ARRENDAMIENTOS')).toBe('');
    expect(esCitaLilian({ sede: 'LILIAN ARRAZOLA', profesional: '' })).toBe(true);
    expect(esCitaLilian({ sede: '', profesional: 'LILIAN ROCIO ARRAZOLA BURBANO' })).toBe(true);
    expect(esCitaLilian({ sede: 'CONSULTORIO', profesional: 'LILIAN ROCIO ARRAZOLA BURBANO' })).toBe(false);
    expect(formaNoEsDelPaciente('TRANSFERENCIAS FACTURACION')).toBe(true);
    expect(formaNoEsDelPaciente('ANTICIPO COPAGO / CUOTA MODERADORA ')).toBe(true);
    expect(formaNoEsDelPaciente('ANTICIPO DESCUENTO')).toBe(false);
    expect(formaNoEsDelPaciente('ANTICIPOS TARJETA')).toBe(false);
  });
});

describe('notas contables — agenda (AP, APL, AE, AEL)', () => {
  it('una nota por día y prefijo, primero las cuentas de servicio y luego la puente; solo CUMPLIDAS', () => {
    const r = notasDesdeAgenda([
      cita({ sede: 'LILIAN ARRAZOLA', referencia: 'CONSULTA ... FISIOTERAPIA SURA POLIZA TAR 46.600 PAC 23.100 ENT 23.500' }),
      cita({ id: '222', nombre: 'LUIS  ROJAS', sede: 'LILIAN ARRAZOLA', referencia: 'CONSULTA ... FISIOTERAPIA SURA POLIZA TAR 46.600 PAC 23.100 ENT 23.500' }),
      cita({ id: '333', estado: 'NO CUMPLIDA', sede: 'LILIAN ARRAZOLA', referencia: 'FISIOTERAPIA TAR 1 PAC 1 ENT 0' }),
      cita({ id: '444', fecha: '2026-06-02', eps: 'PARTICULARES', referencia: 'CONSULTA ... PSICOLOGIA PART 80.000' }),
      cita({ id: '555', referencia: 'CONSULTA FISIOTERAPIA CORTESIA' }),
    ], { APL: 364, AEL: 10, AP: 5 });
    expect(r.notas.map((n) => `${n.prefijo}-${n.numero} ${n.fecha}`)).toEqual(['AP-5 2026-06-02', 'APL-364 2026-06-01', 'AEL-10 2026-06-01']);
    const apl = r.notas[1];
    expect(apl).toMatchObject({ empresa: 'CENTRO DE TERAPIAS INTEGRADAS REHABILITAR S.A.S', tercero: '900431402', concepto: 'ASUME PACIENTE', verificado: 'NO', anulado: 'NO' });
    expect(apl.lineas.map((l) => [l.cuenta, l.tercero, l.debito, l.credito, l.centroCosto])).toEqual([
      ['42559905', '111', null, 23100, 'Sura Póliza'], ['42559905', '222', null, 23100, 'Sura Póliza'],
      ['13990501', '111', 23100, null, 'Sura Póliza'], ['13990501', '222', 23100, null, 'Sura Póliza'],
    ]);
    expect(apl.lineas[1].concepto).toBe('LUIS ROJAS - FISIOTERAPIA - ASUME PACIENTE');
    expect(r.notas[2].lineas.map((l) => l.cuenta)).toEqual(['42509905', '42509905', '13990502', '13990502']);
    expect(r.notas[0].lineas.map((l) => l.cuenta)).toEqual(['42559925', '13990501']);
    expect(r.notas.every(notaCuadrada)).toBe(true);
    expect(r.omitidas.map((o) => o.id)).toEqual(['555']);
  });
});

describe('notas contables — diario de caja (APR, APLR)', () => {
  it('una línea por factura con lo que pagó el paciente; servicio al débito y 13990501 al crédito', () => {
    const items = 'CONSULTA DE CONTROL O DE SEGUIMIENTO POR FISIOTERAPIA COOMEVA TAR 1 PAC 2 ENT 3';
    const r = notasDesdeCaja([
      mov({ documento: 'COPG-7493', entidad: 'COOMEVA MEDICINA PREPAGADA SA 2024', formaPago: 'ANTICIPO DESCUENTO', valor: 10000, itemsRaw: items }),
      mov({ documento: 'COPG-7493', entidad: 'COOMEVA MEDICINA PREPAGADA SA 2024', formaPago: 'EFECTIVO', valor: 10300, itemsRaw: items }),
      mov({ documento: 'R-14895', formaPago: 'ANTICIPO COPAGO / CUOTA MODERADORA', valor: 0, itemsRaw: items }),
      mov({ documento: 'R-14896', estado: 'A', itemsRaw: items }),
      mov({ documento: 'R-14897', id: '890903407', formaPago: 'TRANSFERENCIAS FACTURACION', itemsRaw: 'ABONO DOCUMENTO R-1' }),
      mov({ documento: 'COPL-999', fecha: '2026-05-05', itemsRaw: 'CONSULTA ... PSICOLOGIA SURA POLIZA', entidad: 'SEGUROS DE VIDA SURAMERICANA SA POLIZA 2024', valor: 21400 }),
      mov({ documento: 'ANTR-5', itemsRaw: items }),
    ], { APR: 331, APLR: 20 });
    expect(r.notas.map((n) => `${n.prefijo}-${n.numero} ${n.fecha} ${n.concepto}`)).toEqual([
      'APR-331 2026-05-04 REVERSIÓN ASUME PACIENTE', 'APLR-20 2026-05-05 REVERSIÓN ASUME PACIENTE',
    ]);
    expect(r.notas[0].lineas.map((l) => [l.cuenta, l.concepto, l.debito, l.credito, l.centroCosto])).toEqual([
      ['42559905', 'FV COPG 7493 - ANA PEREZ - FISIOTERAPIA', 20300, null, 'Coomeva'],
      ['13990501', 'FV COPG 7493 - ANA PEREZ - FISIOTERAPIA', null, 20300, 'Coomeva'],
    ]);
    expect(r.notas[1].lineas[0]).toMatchObject({ cuenta: '42559925', debito: 21400, centroCosto: 'Sura Póliza', concepto: 'FV COPL 999 - ANA PEREZ - PSICOLOGIA' });
  });

  it('numeración sugerida sigue las últimas notas cargadas (APL 405, APR 433)', () => {
    const s = siguientesPorDefecto();
    expect(s.APL).toBe(406);
    expect(s.APR).toBe(434);
    expect(s.AP).toBe(1);
  });
});
