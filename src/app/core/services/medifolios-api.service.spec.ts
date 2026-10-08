import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MedifoliosApiService } from './medifolios-api.service';

/**
 * Regresión: antes, un fallo de red/HTTP durante la paginación se tragaba en
 * silencio y la consulta "terminaba bien" con un arreglo vacío — el usuario
 * veía "0 registros" en vez de un error, como si la API nunca se hubiera
 * llamado. Ahora el error debe propagarse hasta el llamador.
 */
describe('MedifoliosApiService — consultas paginadas', () => {
  let service: MedifoliosApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MedifoliosApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('propaga el error en vez de devolver un arreglo vacío cuando la API falla', async () => {
    const promesa = service.consultarCitas('2026-08-01', '2026-08-04');
    const req = httpMock.expectOne((r) => r.url.includes('/citas/listar'));
    req.flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

    await expect(promesa).rejects.toThrow();
  });

  it('devuelve los registros reales cuando la API responde bien', async () => {
    const promesa = service.consultarCitas('2026-08-01', '2026-08-04');
    const req = httpMock.expectOne((r) => r.url.includes('/citas/listar'));
    req.flush(JSON.stringify({ data: [{ id: 1 }, { id: 2 }] }));

    const resultado = await promesa;
    expect(resultado).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
