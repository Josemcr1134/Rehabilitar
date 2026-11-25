/**
 * Las plantillas oficiales de World Office traen una «firma» en las propiedades
 * personalizadas del archivo (docProps/custom.xml): FV_BASICA_LOCAL en facturas,
 * RC en recibos, TER en terceros. World Office la revisa al importar y, si no
 * está, responde «La plantilla que has elegido no es válida».
 *
 * ExcelJS no conserva esas propiedades al guardar, así que después de llenar la
 * plantilla se copia la firma del archivo oficial al archivo generado.
 */
import JSZip from 'jszip';

const PARTE = 'docProps/custom.xml';
const TIPO = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';

/** Devuelve `generado` con las propiedades personalizadas (la firma) de `oficial`. */
export async function conservarFirmaPlantilla(oficial: ArrayBuffer, generado: ArrayBuffer): Promise<ArrayBuffer> {
  const zo = await JSZip.loadAsync(oficial);
  const custom = await zo.file(PARTE)?.async('string');
  if (!custom) return generado;
  const zg = await JSZip.loadAsync(generado);
  zg.file(PARTE, custom);

  const ctFile = zg.file('[Content_Types].xml');
  let ct = ctFile ? await ctFile.async('string') : '';
  if (ct && !ct.includes('/' + PARTE)) {
    ct = ct.replace('</Types>', `<Override PartName="/${PARTE}" ContentType="${TIPO}"/></Types>`);
    zg.file('[Content_Types].xml', ct);
  }
  const relsFile = zg.file('_rels/.rels');
  let rels = relsFile ? await relsFile.async('string') : '';
  if (rels && !rels.includes(REL)) {
    const usados = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
    let n = 1; while (usados.has('rId' + n)) n++;
    rels = rels.replace('</Relationships>', `<Relationship Id="rId${n}" Type="${REL}" Target="${PARTE}"/></Relationships>`);
    zg.file('_rels/.rels', rels);
  }
  return zg.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** Lee las propiedades personalizadas de un .xlsx (para pruebas y diagnóstico). */
export async function leerFirmaPlantilla(archivo: ArrayBuffer): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(archivo);
  const xml = (await z.file(PARTE)?.async('string')) || '';
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<property[^>]*name="([^"]+)"[^>]*>\s*<vt:\w+>([^<]*)<\/vt:\w+>/g)) out[m[1]] = m[2];
  return out;
}
