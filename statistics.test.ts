import { describe, expect, it } from "vitest";
import { buildStatisticalReport, type StatisticalChamado } from "./statistics";

function item(overrides: Partial<StatisticalChamado>): StatisticalChamado {
  return {
    id: 1,
    status: "aberto",
    tipo: "preventivo",
    subprefeitura: "Sé",
    gutScore: 10,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    ...overrides,
  };
}

describe("relatório estatístico", () => {
  it("retorna indicadores neutros para uma base vazia", () => {
    expect(buildStatisticalReport([])).toMatchObject({
      total: 0,
      resolved: 0,
      pending: 0,
      resolutionRatePct: 0,
      meanGut: 0,
      medianGut: 0,
      standardDeviationGut: 0,
      averageResolutionHours: null,
      priorityQueue: [],
    });
  });

  it("calcula média, mediana e desvio-padrão populacional", () => {
    const report = buildStatisticalReport([
      item({ id: 1, gutScore: 10 }),
      item({ id: 2, gutScore: 20 }),
      item({ id: 3, gutScore: 30 }),
    ]);
    expect(report.meanGut).toBe(20);
    expect(report.medianGut).toBe(20);
    expect(report.standardDeviationGut).toBe(8.16);
  });

  it("calcula mediana para quantidade par de valores", () => {
    const report = buildStatisticalReport([
      item({ id: 1, gutScore: 10 }),
      item({ id: 2, gutScore: 20 }),
      item({ id: 3, gutScore: 40 }),
      item({ id: 4, gutScore: 90 }),
    ]);
    expect(report.medianGut).toBe(30);
  });

  it("calcula taxa e tempo médio de resolução", () => {
    const report = buildStatisticalReport([
      item({
        id: 1,
        status: "concluido",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        resolvedAt: new Date("2026-01-02T00:00:00Z"),
      }),
      item({ id: 2, status: "aberto" }),
    ]);
    expect(report.resolutionRatePct).toBe(50);
    expect(report.averageResolutionHours).toBe(24);
  });

  it("ordena a fila por GUT e usa a data como desempate", () => {
    const report = buildStatisticalReport([
      item({ id: 1, gutScore: 20, createdAt: new Date("2026-01-03T00:00:00Z") }),
      item({ id: 2, gutScore: 80, createdAt: new Date("2026-01-02T00:00:00Z") }),
      item({ id: 3, gutScore: 80, createdAt: new Date("2026-01-01T00:00:00Z") }),
      item({ id: 4, gutScore: 125, status: "concluido" }),
    ]);
    expect(report.priorityQueue.map(row => row.chamadoId)).toEqual([3, 2, 1]);
    expect(report.priorityQueue.map(row => row.position)).toEqual([1, 2, 3]);
  });

  it("agrupa registros por status, tipo e subprefeitura", () => {
    const report = buildStatisticalReport([
      item({ id: 1, status: "aberto", tipo: "preventivo", subprefeitura: "Sé" }),
      item({ id: 2, status: "concluido", tipo: "urgente", subprefeitura: "Sé" }),
      item({ id: 3, status: "aberto", tipo: "urgente", subprefeitura: null }),
    ]);
    expect(report.byStatus).toEqual(expect.arrayContaining([
      { label: "aberto", count: 2 },
      { label: "concluido", count: 1 },
    ]));
    expect(report.byTipo).toEqual(expect.arrayContaining([
      { label: "urgente", count: 2 },
      { label: "preventivo", count: 1 },
    ]));
    expect(report.bySubprefeitura[0]).toEqual({ label: "Sé", count: 2 });
  });
});
