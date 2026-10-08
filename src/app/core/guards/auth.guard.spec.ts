import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authGuard } from './auth.guard';
import { AppStateService } from '../services/app-state.service';

describe('authGuard', () => {
  it('deja pasar cuando hay token', () => {
    TestBed.configureTestingModule({});
    const appState = TestBed.inject(AppStateService);
    appState.token.set('abc123');
    const resultado = TestBed.runInInjectionContext(() => authGuard({} as any, { url: '/conciliar' } as any));
    expect(resultado).toBe(true);
  });

  it('redirige a conexion-api con returnUrl cuando no hay token', () => {
    TestBed.configureTestingModule({});
    const router = TestBed.inject(Router);
    const resultado = TestBed.runInInjectionContext(() => authGuard({} as any, { url: '/conciliar' } as any));
    expect(resultado).not.toBe(true);
    const tree = router.serializeUrl(resultado as any);
    expect(tree).toContain('/conexion-api');
    expect(tree).toContain('returnUrl=%2Fconciliar');
  });
});
