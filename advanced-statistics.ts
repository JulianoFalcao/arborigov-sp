import type { StatisticalChamado } from './statistics';

export type NumericPair = { x: number; y: number };
const rounded = (n: number, digits = 6) => Number(n.toFixed(digits));

export function averageRanks(values: number[]) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < ordered.length;) {
    let j = i + 1;
    while (j < ordered.length && ordered[j].value === ordered[i].value) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[ordered[k].index] = rank;
    i = j;
  }
  return ranks;
}

/** OLS with intercept. Undefined statistics remain null, not artificial zeroes. */
export function analyzePairs(input: NumericPair[]) {
  const pairs = input.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pairs.length;
  const base = { n, excluded: input.length - n, pearson: null as number | null, spearman: null as number | null,
    slope: null as number | null, intercept: null as number | null, rSquared: null as number | null,
    rmse: null as number | null, xMin: n ? Math.min(...pairs.map(p => p.x)) : null,
    xMax: n ? Math.max(...pairs.map(p => p.x)) : null };
  if (n < 3) return base;
  const meanX = pairs.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pairs.reduce((s, p) => s + p.y, 0) / n;
  const xx = pairs.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  const yy = pairs.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const xy = pairs.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  if (xx <= 1e-12) return base;
  const slope = xy / xx;
  const intercept = meanY - slope * meanX;
  const residualSum = pairs.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const pearson = yy > 1e-12 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
  const rankX = averageRanks(pairs.map(p => p.x));
  const rankY = averageRanks(pairs.map(p => p.y));
  const center = (n + 1) / 2;
  const rxx = rankX.reduce((s, v) => s + (v - center) ** 2, 0);
  const ryy = rankY.reduce((s, v) => s + (v - center) ** 2, 0);
  const rxy = rankX.reduce((s, v, i) => s + (v - center) * (rankY[i] - center), 0);
  return { ...base, pearson: pearson === null ? null : rounded(pearson),
    spearman: rxx && ryy ? rounded(Math.max(-1, Math.min(1, rxy / Math.sqrt(rxx * ryy)))) : null,
    slope: rounded(slope), intercept: rounded(intercept),
    rSquared: yy > 1e-12 ? rounded(Math.max(0, Math.min(1, 1 - residualSum / yy))) : null,
    rmse: rounded(Math.sqrt(residualSum / n)) };
}

/** Snapshot of surviving pending tickets, not completed service durations. */
export function buildAdvancedReport(items: StatisticalChamado[], asOf = new Date()) {
  if (!Number.isFinite(asOf.getTime())) throw new Error('Data de referência inválida');
  const now = asOf.getTime();
  const pending = items.filter(item => item.status !== 'concluido');
  const points = pending.flatMap(item => {
    const created = new Date(item.createdAt).getTime();
    const age = (now - created) / 86_400_000;
    return Number.isFinite(age) && age >= 0 && Number.isFinite(item.gutScore) && item.gutScore >= 1 && item.gutScore <= 125
      ? [{ gutScore: item.gutScore, ageDays: rounded(age) }] : [];
  });
  const model = analyzePairs(points.map(p => ({ x: p.gutScore, y: p.ageDays })));
  const resolution = items.filter(item => item.status === 'concluido').flatMap(item => {
    const start = new Date(item.createdAt).getTime();
    const end = item.resolvedAt ? new Date(item.resolvedAt).getTime() : NaN;
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= now
      ? [{ x: item.gutScore, y: (end - start) / 86_400_000 }] : [];
  });
  const eligibleResolution = resolution.length >= 10;
  const regressionLine = model.slope !== null && model.intercept !== null && model.xMin !== null && model.xMax !== null
    ? [model.xMin, model.xMax].map(x => ({ gutScore: x, fittedAgeDays: rounded(model.intercept! + model.slope! * x) })) : [];
  return {
    generatedAt: asOf, total: items.length, pendingTotal: pending.length,
    excludedPending: pending.length - points.length, model, points, regressionLine,
    resolutionSample: resolution.length,
    resolutionModel: eligibleResolution ? analyzePairs(resolution) : null,
    agedHighRisk: points.filter(p => p.gutScore >= 64 && p.ageDays >= 30).length,
    oldestAgeDays: points.length ? rounded(Math.max(...points.map(p => p.ageDays)), 2) : null,
    interpretation: model.pearson === null
      ? 'Amostra sem tamanho ou variabilidade suficiente para estimar a associação.'
      : `Pearson r = ${model.pearson} e Spearman ρ = ${model.spearman}: associação observada entre GUT e idade dos chamados ainda pendentes. Não representa tempo de resolução nem prova efeito causal da prioridade.`,
    warnings: [
      'Base de homologação: os resultados não medem a operação real da Prefeitura.',
      'Chamados pendentes são uma amostra sobrevivente: casos já concluídos não entram nesta regressão.',
      'Datas de criação agrupadas por testes e mudanças no GUT podem produzir associações artificiais.',
      'A reta é um ajuste descritivo dentro da amostra; não é previsão de SLA nem modelo validado fora da amostra.',
      'GUT é uma escala de priorização construída e não uma medição contínua de risco físico.',
      ...(eligibleResolution ? [] : [`Somente ${resolution.length} conclusões com datas válidas. Regressão do tempo de resolução bloqueada; mínimo operacional de 10 pares é uma barreira inicial, não garantia de qualidade estatística.`]),
    ],
  };
}
