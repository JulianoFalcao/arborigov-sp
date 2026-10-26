import { describe, expect, it } from "vitest";
import { topPriority, type PriorityItem } from "./priority";

function item(id: number, gutScore: number, day: number, status = "aberto"): PriorityItem {
  return { id, gutScore, createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`), status, subprefeitura: "Pinheiros" };
}

describe("heap de priorização de chamados", () => {
  it("seleciona top k sem ordenar todos os itens", () => {
    const chosen = topPriority([item(1, 20, 1), item(2, 80, 2), item(3, 40, 3), item(4, 100, 4)], 2);
    expect(chosen.map(c => c.id)).toEqual([4, 2]);
  });
  it("desempata por antiguidade e por menor id", () => {
    expect(topPriority([item(3, 80, 3), item(2, 80, 2), item(1, 80, 2)], 2).map(c => c.id)).toEqual([1, 2]);
  });
  it("exclui concluídos e lida com fila vazia", () => {
    expect(topPriority([item(1, 125, 1, "concluido"), item(2, 27, 2)], 5).map(c => c.id)).toEqual([2]);
    expect(topPriority([], 5)).toEqual([]);
    expect(topPriority([item(1, 125, 1)], 0)).toEqual([]);
  });
  it("rejeita limites inválidos", () => {
    expect(() => topPriority([], -1)).toThrow(RangeError);
    expect(() => topPriority([], 1.5)).toThrow(RangeError);
  });
});
