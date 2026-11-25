import { analizarOrigenTarifas, diferenciaNoConciliada, puenteAgenda, redondearCOP } from './origen-tarifas.util';
import { extraerTarifa } from './tarifa.util';

/** Reporte con encabezados en la fila 1, como los arma la importación de Excel. */
const archivo = (headers: string[], filas: unknown[][]) => ({ nombre: 'x', hoja: 'x', filaEnc: 1, headers, matriz: [headers, ...filas], objetos: [] }) as any;
const AGENDA_H = ['PACIENTE', 'ID. PACIENTE', 'FECHA ASIGNADA', 'REFERENCIA', 'ESTADO'];
const CAJA_H = ['FECHA', 'FORMA PAGO', 'NUM. DOCUMENTO', 'ID. TERCERO', 'NOM TERCERO', 'VALOR', 'ITEMS', 'ESTADO', 'FECHA REGISTRO'];

describe('Tarifario detectado', () => {
  it('lee PACIENTE y ENTIDAD escritos completos cuando también hay TAR', () => {
    const t = extraerTarifa('CONSULTA ... FISIOTERAPIA PROBIENESTAR 2025 TAR 30.000 PACIENTE 19.000 ENTIDAD 11.000');
    expect([t.tar, t.pac, t.ent, t.detectado]).toEqual([30000, 19000, 11000, true]);
  });
  it('sigue leyendo los formatos que ya funcionaban', () => {
    expect([extraerTarifa('X TAR 38.900 PAC 19.000 ENT 19.900').pac, extraerTarifa('X PART 80.000').pac, extraerTarifa('X PACIENTE 25.000 ENTIDAD 0').pac]).toEqual([19000, 80000, 25000]);
  });
  it('la cortesía es una tarifa detectada en cero', () => {
    const t = extraerTarifa('CONSULTA DE CONTROL POR FISIOTERAPIA CORTESIA');
    expect([t.tar, t.pac, t.ent, t.detectado, t.tipo]).toEqual([0, 0, 0, true, 'CORTESIA']);
  });
});

describe('Diferencia no conciliada (casos A–E)', () => {
  it('A · conciliación completa: cero y CUADRA', () => {
    expect(diferenciaNoConciliada(100000, { pagoDelDia: 60000, anticipoDescuento: 30000, credito: 10000 }, true)).toEqual({ valor: 0, estado: 'CUADRA' });
  });
  it('B · diferencia pendiente: muestra la diferencia real', () => {
    expect(diferenciaNoConciliada(100000, { pagoDelDia: 60000, anticipoDescuento: 0, credito: 0 }, true)).toEqual({ valor: 40000, estado: 'PENDIENTE' });
  });
  it('C · parcial y excedente: refleja lo que falta o lo que sobra', () => {
    expect(diferenciaNoConciliada(100000, { pagoDelDia: 60000, anticipoDescuento: 20000, credito: 0 }, true)).toEqual({ valor: 20000, estado: 'PENDIENTE' });
    expect(diferenciaNoConciliada(100000, { pagoDelDia: 120000, anticipoDescuento: 0, credito: 0 }, true)).toEqual({ valor: -20000, estado: 'EXCEDENTE' });
  });
  it('D · sin movimientos: no se confunde con «cuadra»', () => {
    expect(diferenciaNoConciliada(0, { pagoDelDia: 0, anticipoDescuento: 0, credito: 0 }, false)).toEqual({ valor: 0, estado: 'SIN MOVIMIENTOS' });
  });
  it('E · decimales: sin diferencias artificiales de coma flotante', () => {
    expect(0.1 + 0.2 - 0.3).not.toBe(0);
    expect(diferenciaNoConciliada(0.3, { pagoDelDia: 0.1, anticipoDescuento: 0.2, credito: 0 }, true)).toEqual({ valor: 0, estado: 'CUADRA' });
    expect(diferenciaNoConciliada(1000.55, { pagoDelDia: 1000.1, anticipoDescuento: 0, credito: 0 }, true)).toEqual({ valor: 0.45, estado: 'PENDIENTE' });
    expect(redondearCOP(19999.999)).toBe(20000);
  });
});

describe('Resumen ejecutivo con documentos anulados', () => {
  const o = analizarOrigenTarifas({
    AGENDA: archivo(AGENDA_H, [
      ['ANA', '111', '2026-08-04', 'FISIOTERAPIA TAR 46.200 PAC 23.100 ENT 23.100', 'CUMPLIDA'],
      ['LUIS', '222', '2026-08-04', 'FISIOTERAPIA PART 30.000', 'CUMPLIDA'],
    ]),
    CAJA: archivo(CAJA_H, [
      ['2026-08-04', 'ANTICIPO DESCUENTO', 'COPG-8552', '111', 'ANA', 23100, 'FISIOTERAPIA', 'A', '2026-08-04 15:54:10'],
      ['2026-08-04', 'EFECTIVO', 'R-1', '222', 'LUIS', 30000, 'FISIOTERAPIA PART 30.000', 'F', ''],
      ['2026-08-04', 'TARJETA', 'ANTR-9', '222', 'LUIS', 100000, 'ANTICIPO', 'F', ''],
    ]),
  }, 0);
  const p = puenteAgenda(o, 0);

  it('el anulado no suma en anticipo ni en total asume paciente, y la diferencia ya no se esconde en cero', () => {
    expect(o.anticipoDescuento).toBe(0);
    expect(p.totalAsumePaciente).toBe(30000);
    expect([p.difNoConciliada, p.estadoDiferencia]).toEqual([23100, 'PENDIENTE']);
  });
  it('conserva documento, fecha y valor del anulado', () => {
    expect(o.anulados).toEqual([{ documento: 'COPG-8552', fecha: '2026-08-04', fechaRegistro: '2026-08-04 15:54:10', id: '111', nombre: 'ANA', formaPago: 'ANTICIPO DESCUENTO', valor: 23100 }]);
  });
  it('«Total reporte de caja» es la suma del reporte tal cual (incluye anulados y anticipos recibidos)', () => {
    expect(o.totalCaja).toBe(153100);
  });
});

describe('Asume paciente: solo citas cumplidas y solo facturas de pacientes', () => {
  const o = analizarOrigenTarifas({
    AGENDA: archivo(AGENDA_H, [
      ['ANA', '111', '2026-08-04', 'FISIOTERAPIA TAR 46.200 PAC 23.100 ENT 23.100', 'CUMPLIDA'],
      ['EVA', '333', '2026-08-04', 'FISIOTERAPIA PART 50.000', 'NO CUMPLIDA'],
      ['LEO', '444', '2026-08-04', 'FISIOTERAPIA PART 50.000', 'CANCELADA'],
    ]),
    CAJA: archivo(CAJA_H, [
      ['2026-08-04', 'EFECTIVO', 'COPG-1', '111', 'ANA', 23100, 'FISIOTERAPIA', 'F', ''],
      ['2026-08-04', 'EFECTIVO', 'RCL-A-7', '111', 'ANA', 10000, 'ABONO', 'F', ''],
      ['2026-08-04', 'TRANSFERENCIA A BANCOLOMBIA REHABILITAR', 'R-2', '890903407', 'SEGUROS SA', 500000, 'ABONO DOCUMENTO R-1', 'F', ''],
      ['2026-08-04', 'TARJETA', 'ANTL-3', '555', 'SOL', 80000, 'ANTICIPO', 'F', ''],
      ['2026-08-04', 'CREDITO-DEUDA', 'R-4', '890903407', 'SEGUROS SA', 7000, 'X', 'F', ''],
    ]),
  }, 0);
  const p = puenteAgenda(o, 0);

  it('las citas no cumplidas no suman venta ni asume paciente', () => {
    expect([o.agenda.sesiones, o.agenda.pac, o.citasNoCumplidas]).toEqual([1, 23100, 2]);
  });
  it('RCL-A (abono a deuda) y terceros con NIT no son asume paciente', () => {
    expect([p.pagoDelDia, p.credito, p.totalAsumePaciente]).toEqual([23100, 0, 23100]);
    expect(o.fueraAsumePaciente).toEqual({ abonosDeuda: 10000, anticiposRecibidos: 80000, entidades: 507000, otros: 0 });
    expect([o.conNit, o.conNitMov]).toEqual([507000, 2]);
  });
  it('asume paciente + abonos + anticipos + entidades + anulados + otros = total del reporte', () => {
    const f = o.fueraAsumePaciente;
    expect(p.totalAsumePaciente + f.abonosDeuda + f.anticiposRecibidos + f.entidades + f.otros).toBe(o.totalCaja);
    expect([p.difNoConciliada, p.estadoDiferencia]).toEqual([0, 'CUADRA']);
  });
  it('sin columna ESTADO en la agenda se cuentan todas las citas, como antes', () => {
    const o2 = analizarOrigenTarifas({ AGENDA: archivo(['PACIENTE', 'ID. PACIENTE', 'REFERENCIA'], [['A', '1', 'X PART 10.000'], ['B', '2', 'X PART 20.000']]) }, 0);
    expect([o2.agenda.sesiones, o2.agenda.pac, o2.citasNoCumplidas]).toEqual([2, 30000, 0]);
  });
});
