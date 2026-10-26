import { describe, it, expect } from 'vitest';
import { analyzePairs, averageRanks, buildAdvancedReport } from './advanced-statistics';
import type { StatisticalChamado } from './statistics';
const at = new Date('2026-10-15T12:00:00Z');
const ticket = (id: number, days: number, gutScore: number, extra: Partial<StatisticalChamado> = {}): StatisticalChamado => ({ id, tipo: 'preventivo', status: 'aberto', subprefeitura: null, gutScore, createdAt: new Date(at.getTime() - days * 86400000), resolvedAt: null, ...extra });
describe('estatística avançada', () => {
  it('ajusta uma reta conhecida com intercepto', () => {
    const m = analyzePairs([1, 2, 3, 4].map(x => ({ x, y: 2 + 3 * x })));
    expect(m).toMatchObject({ n: 4, pearson: 1, spearman: 1, slope: 3, intercept: 2, rSquared: 1, rmse: 0 });
  });
  it('detecta associação inversa perfeita', () => {
    expect(analyzePairs([1,2,3].map(x => ({ x, y: 10 - x })))).toMatchObject({ pearson: -1, spearman: -1, slope: -1 });
  });
  it('não inventa correlação com x constante', () => {
    expect(analyzePairs([1,2,3].map(y => ({ x: 5, y })))).toMatchObject({ pearson: null, slope: null, rSquared: null });
  });
  it('trata y constante sem correlação definida', () => {
    expect(analyzePairs([1,2,3].map(x => ({ x, y: 7 })))).toMatchObject({ pearson: null, spearman: null, slope: 0, intercept: 7, rSquared: null });
  });
  it('usa postos médios para empates', () => {
    expect(averageRanks([20,10,20,40])).toEqual([2.5,1,2.5,4]);
    expect(analyzePairs([{x:1,y:3},{x:1,y:3},{x:2,y:4}]).spearman).toBe(1);
  });
  it('exclui NaN e infinito e protege amostra pequena', () => {
    expect(analyzePairs([{x:1,y:2},{x:NaN,y:4},{x:2,y:Infinity}])).toMatchObject({ n:1, excluded:2, slope:null });
  });
  it('exclui concluídos, datas futuras e GUT inválido da idade pendente', () => {
    const r = buildAdvancedReport([ticket(1,10,4),ticket(2,20,10),ticket(3,30,20),ticket(4,-1,20),ticket(5,3,0),ticket(6,2,50,{status:'concluido',resolvedAt:at})],at);
    expect(r).toMatchObject({ total:6, pendingTotal:5, excludedPending:2, resolutionSample:1, resolutionModel:null });
    expect(r.points).toHaveLength(3);
    expect(r.points[0]).toEqual({gutScore:4,ageDays:10});
  });
  it('conta casos críticos envelhecidos sem extrapolar SLA', () => {
    const r = buildAdvancedReport([ticket(1,30,64),ticket(2,29,125),ticket(3,60,50)],at);
    expect(r.agedHighRisk).toBe(1);
    expect(r.oldestAgeDays).toBe(60);
    expect(r.warnings.join(' ')).toContain('não é previsão de SLA');
  });
  it('não expõe identificadores nem modifica entradas', () => {
    const items=[ticket(1,10,5),ticket(2,20,10),ticket(3,30,20)];
    const before=JSON.stringify(items);
    const r=buildAdvancedReport(items,at);
    expect(JSON.stringify(items)).toBe(before);
    expect(Object.keys(r.points[0])).toEqual(['gutScore','ageDays']);
  });
  it('rejeita data de referência inválida', () => {
    expect(() => buildAdvancedReport([],new Date(NaN))).toThrow('Data de referência inválida');
  });
});
