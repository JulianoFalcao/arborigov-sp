import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrpcContext } from './_core/context';
const mocks = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock('./db', async (importOriginal) => ({ ...await importOriginal<typeof import('./db')>(), getChamadosForStatistics: mocks.rows }));
import { appRouter } from './routers';
const context = (role: 'admin' | 'user' | null): TrpcContext => ({
  user: role ? { id: 901, role, openId: 'synthetic-test', name: 'Fixture de teste', email: null, phone: null, loginMethod: 'test', createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } : null,
  req: { headers: {}, protocol: 'https' } as TrpcContext['req'],
  res: {} as TrpcContext['res'],
});
describe('stats.advanced autorização', () => {
  beforeEach(() => { mocks.rows.mockReset(); });
  it('bloqueia visitante antes de consultar o banco', async () => {
    await expect(appRouter.createCaller(context(null)).stats.advanced()).rejects.toMatchObject({code:'UNAUTHORIZED'});
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it('bloqueia cidadão antes de consultar o banco', async () => {
    await expect(appRouter.createCaller(context('user')).stats.advanced()).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it('gestor recebe somente pares numéricos e estado de amostra', async () => {
    mocks.rows.mockResolvedValue([{id:901,status:'aberto',tipo:'preventivo',subprefeitura:null,gutScore:20,createdAt:new Date('2026-10-01T00:00:00Z'),resolvedAt:null}]);
    const r = await appRouter.createCaller(context('admin')).stats.advanced();
    expect(r.total).toBe(1);
    expect(Object.keys(r.points[0])).toEqual(['gutScore','ageDays']);
    expect(r.resolutionModel).toBeNull();
  });
});
