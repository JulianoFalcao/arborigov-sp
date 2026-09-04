export type StatisticalChamado = {
  id: number;
  status: string;
  tipo: string;
  subprefeitura: string | null;
  gutScore: number;
  createdAt: Date;
  resolvedAt: Date | null;
};

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function populationStandardDeviation(values: number[], mean: number) {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function buildStatisticalReport(items: StatisticalChamado[]) {
  const total = items.length;
  const gutScores = items.map(item => item.gutScore);
  const meanGut = total ? gutScores.reduce((sum, value) => sum + value, 0) / total : 0;
  const resolved = items.filter(item => item.status === "concluido");
  const resolutionHours = resolved
    .filter(item => item.resolvedAt)
    .map(item => (item.resolvedAt!.getTime() - item.createdAt.getTime()) / 3_600_000)
    .filter(hours => hours >= 0);

  const byStatus = Object.entries(
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([label, count]) => ({ label, count }));

  const byTipo = Object.entries(
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.tipo] = (acc[item.tipo] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([label, count]) => ({ label, count }));

  const bySubprefeitura = Object.entries(
    items.reduce<Record<string, number>>((acc, item) => {
      const label = item.subprefeitura ?? "Não informada";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const priorityQueue = [...items]
    .filter(item => item.status !== "concluido")
    .sort((a, b) => b.gutScore - a.gutScore || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, 10)
    .map((item, index) => ({
      position: index + 1,
      chamadoId: item.id,
      gutScore: item.gutScore,
      status: item.status,
    }));

  return {
    generatedAt: new Date(),
    total,
    resolved: resolved.length,
    pending: total - resolved.length,
    resolutionRatePct: total ? round((resolved.length / total) * 100, 1) : 0,
    meanGut: round(meanGut),
    medianGut: round(median(gutScores)),
    standardDeviationGut: round(populationStandardDeviation(gutScores, meanGut)),
    averageResolutionHours: resolutionHours.length
      ? round(resolutionHours.reduce((sum, value) => sum + value, 0) / resolutionHours.length, 1)
      : null,
    byStatus,
    byTipo,
    bySubprefeitura,
    priorityQueue,
  };
}
