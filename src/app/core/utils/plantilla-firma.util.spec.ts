import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { conservarFirmaPlantilla, leerFirmaPlantilla } from './plantilla-firma.util';
import { COLUMNAS_RECIBO, llenarPlantillaRecibo } from './world-office-plantillas.util';

const CUSTOM = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
  + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="RC">'
  + '<vt:lpwstr>FIRMA-PRUEBA</vt:lpwstr></property></Properties>';

/** Plantilla de recibos simulada CON firma, como las oficiales de World Office. */
async function plantillaFirmada(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [nombre, cols] of Object.entries(COLUMNAS_RECIBO)) wb.addWorksheet(nombre).addRow(cols);
  wb.addWorksheet('Listas').state = 'hidden';
  const z = await JSZip.loadAsync((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  z.file('docProps/custom.xml', CUSTOM);
  z.file('[Content_Types].xml', (await z.file('[Content_Types].xml')!.async('string')).replace('</Types>',
    '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'));
  z.file('_rels/.rels', (await z.file('_rels/.rels')!.async('string')).replace('</Relationships>',
    '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>'));
  return z.generateAsync({ type: 'arraybuffer' });
}

describe('Firma de las plantillas oficiales de World Office', () => {
  it('ExcelJS la borra al guardar (por eso hay que restaurarla)', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await plantillaFirmada());
    expect(await leerFirmaPlantilla((await wb.xlsx.writeBuffer()) as ArrayBuffer)).toEqual({});
  });

  it('la plantilla de recibos llenada conserva la firma «RC» y sigue siendo un Excel válido', async () => {
    const out = await llenarPlantillaRecibo(await plantillaFirmada(), []);
    expect(await leerFirmaPlantilla(out)).toEqual({ RC: 'FIRMA-PRUEBA' });
    const z = await JSZip.loadAsync(out);
    expect(await z.file('[Content_Types].xml')!.async('string')).toContain('/docProps/custom.xml');
    expect(await z.file('_rels/.rels')!.async('string')).toContain('docProps/custom.xml');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Encabezados', 'Detalles Contables', 'Listas']);
  });

  it('si la plantilla no trae firma, no agrega nada', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('X');
    const sin = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    expect(await conservarFirmaPlantilla(sin, sin)).toBe(sin);
  });
});
