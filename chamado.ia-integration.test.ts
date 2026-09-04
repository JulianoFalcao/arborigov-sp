import { describe, expect, it } from "vitest";
import { calculateGutScores } from "./risk";

describe("classificação GUT assistida por IA", () => {
  it("aplica a heurística de chamado urgente sem análise de IA", () => {
    expect(calculateGutScores({ tipo: "urgente", contatoFiacao: "nao" })).toEqual({
      gravidade: 5,
      urgencia: 5,
      tendencia: 3,
      gutScore: 75,
    });
  });

  it("mantém compatibilidade com chamado preventivo sem IA", () => {
    expect(calculateGutScores({ tipo: "preventivo", contatoFiacao: "nao" })).toEqual({
      gravidade: 3,
      urgencia: 2,
      tendencia: 3,
      gutScore: 18,
    });
  });

  it("converte corretamente a saúde geral em gravidade", () => {
    const cases = [
      ["excelente", 1],
      ["boa", 2],
      ["regular", 3],
      ["ruim", 4],
      ["crítica", 5],
    ] as const;
    for (const [saude, gravidade] of cases) {
      expect(calculateGutScores({
        tipo: "preventivo",
        contatoFiacao: "nao",
        iaAnalysis: { saude_geral: saude, risco_queda: "baixo", recomendacoes: [] },
      }).gravidade).toBe(gravidade);
    }
  });

  it("converte corretamente o risco de queda em urgência", () => {
    const cases = [
      ["baixo", 2],
      ["médio", 3],
      ["alto", 4],
      ["crítico", 5],
    ] as const;
    for (const [risco, urgencia] of cases) {
      expect(calculateGutScores({
        tipo: "preventivo",
        contatoFiacao: "nao",
        iaAnalysis: { saude_geral: "regular", risco_queda: risco, recomendacoes: [] },
      }).urgencia).toBe(urgencia);
    }
  });

  it("considera remoção e tratamento na tendência", () => {
    const remocao = calculateGutScores({
      tipo: "preventivo",
      contatoFiacao: "nao",
      iaAnalysis: { recomendacoes: ["remoção da árvore"] },
    });
    const tratamento = calculateGutScores({
      tipo: "preventivo",
      contatoFiacao: "nao",
      iaAnalysis: { recomendacoes: ["tratamento fitossanitário"] },
    });
    expect(remocao.tendencia).toBe(4);
    expect(tratamento.tendencia).toBe(3);
  });

  it("prioriza contato com fiação e calcula o produto final", () => {
    const result = calculateGutScores({
      tipo: "preventivo",
      contatoFiacao: "sim",
      iaAnalysis: {
        saude_geral: "crítica",
        risco_queda: "alto",
        recomendacoes: ["remoção"],
      },
    });
    expect(result).toEqual({ gravidade: 5, urgencia: 4, tendencia: 5, gutScore: 100 });
  });
});
