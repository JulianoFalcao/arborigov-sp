export type RiskInput = {
  tipo: "preventivo" | "urgente";
  contatoFiacao: "sim" | "nao";
  iaAnalysis?: {
    saude_geral?: string;
    risco_queda?: string;
    recomendacoes?: string[];
  };
};

export function calculateGutScores(input: RiskInput) {
  if (!input.iaAnalysis) {
    const gravidade = input.tipo === "urgente" ? 5 : 3;
    const urgencia = input.tipo === "urgente" ? 5 : 2;
    const tendencia = input.contatoFiacao === "sim" ? 5 : 3;
    return { gravidade, urgencia, tendencia, gutScore: gravidade * urgencia * tendencia };
  }

  const saudeMap: Record<string, number> = {
    "crítica": 5,
    ruim: 4,
    regular: 3,
    boa: 2,
    excelente: 1,
  };
  const riscoMap: Record<string, number> = {
    "crítico": 5,
    alto: 4,
    "médio": 3,
    baixo: 2,
  };
  const recomendacoes = input.iaAnalysis.recomendacoes ?? [];
  const temRemocao = recomendacoes.some(item => item.toLowerCase().includes("remoção"));
  const temTratamento = recomendacoes.some(item => item.toLowerCase().includes("tratamento"));
  const gravidade = saudeMap[input.iaAnalysis.saude_geral ?? "regular"] ?? 3;
  const urgencia = riscoMap[input.iaAnalysis.risco_queda ?? "médio"] ?? 3;
  const tendencia = input.contatoFiacao === "sim" ? 5 : temRemocao ? 4 : temTratamento ? 3 : 2;

  return { gravidade, urgencia, tendencia, gutScore: gravidade * urgencia * tendencia };
}
