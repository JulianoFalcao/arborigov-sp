import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "cidadao@example.com",
    name: "Cidadão Teste",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

const VALID_BASE64_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("chamado - IA Integration Flow", { timeout: 30000 }, () => {
  it("creates chamado with heuristic GUT when no IA analysis provided", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.chamado.create({
      tipo: "urgente",
      descricao: "Árvore com problema grave",
      endereco: "Rua das Flores, 123",
      subprefeitura: "Pinheiros",
      contatoFiacao: "nao",
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();

    // Verificar que o chamado foi criado com GUT padrão
    const chamado = await caller.chamado.getById({ id: result.id });
    expect(chamado).toBeDefined();
    expect(chamado.tipo).toBe("urgente");
    // Heurística: urgente = gravidade 5, urgencia 5, tendencia 3
    expect(chamado.gravidade).toBe(5);
    expect(chamado.urgencia).toBe(5);
    expect(chamado.tendencia).toBe(3);
    expect(chamado.gutScore).toBe(5 * 5 * 3); // 75
  });

  it("creates chamado with IA-based GUT when analysis provided", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const iaAnalysis = {
      saude_geral: "crítica",
      risco_queda: "alto",
      recomendacoes: ["remoção", "isolamento"],
    };

    const result = await caller.chamado.create({
      tipo: "preventivo",
      descricao: "Árvore com análise de IA",
      endereco: "Avenida Paulista, 1000",
      subprefeitura: "Centro",
      contatoFiacao: "sim",
      iaAnalysis,
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeDefined();

    // Verificar que o chamado foi criado com GUT baseado em IA
    const chamado = await caller.chamado.getById({ id: result.id });
    expect(chamado).toBeDefined();

    // IA: saude_geral "crítica" = gravidade 5
    // IA: risco_queda "alto" = urgencia 4
    // IA: recomendacoes contém "remoção" + contatoFiacao "sim" = tendencia 5
    expect(chamado.gravidade).toBe(5);
    expect(chamado.urgencia).toBe(4);
    expect(chamado.tendencia).toBe(5);
    expect(chamado.gutScore).toBe(5 * 4 * 5); // 100
  });

  it("calculates correct gravidade from saude_geral", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const testCases = [
      { saude: "excelente", expectedGravidade: 1 },
      { saude: "boa", expectedGravidade: 2 },
      { saude: "regular", expectedGravidade: 3 },
      { saude: "ruim", expectedGravidade: 4 },
      { saude: "crítica", expectedGravidade: 5 },
    ];

    for (const testCase of testCases) {
      const result = await caller.chamado.create({
        tipo: "preventivo",
        descricao: `Teste saúde ${testCase.saude}`,
        endereco: "Rua Teste, 1",
        iaAnalysis: {
          saude_geral: testCase.saude,
          risco_queda: "baixo",
          recomendacoes: [],
        },
      });

      const chamado = await caller.chamado.getById({ id: result.id });
      expect(chamado.gravidade).toBe(testCase.expectedGravidade);
    }
  });

  it("calculates correct urgencia from risco_queda", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const testCases = [
      { risco: "baixo", expectedUrgencia: 2 },
      { risco: "médio", expectedUrgencia: 3 },
      { risco: "alto", expectedUrgencia: 4 },
      { risco: "crítico", expectedUrgencia: 5 },
    ];

    for (const testCase of testCases) {
      const result = await caller.chamado.create({
        tipo: "preventivo",
        descricao: `Teste risco ${testCase.risco}`,
        endereco: "Rua Teste, 2",
        iaAnalysis: {
          saude_geral: "regular",
          risco_queda: testCase.risco,
          recomendacoes: [],
        },
      });

      const chamado = await caller.chamado.getById({ id: result.id });
      expect(chamado.urgencia).toBe(testCase.expectedUrgencia);
    }
  });

  it("calculates correct tendencia from recomendacoes and fiacao", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    // Teste 1: Contato com fiação = tendencia 5
    const result1 = await caller.chamado.create({
      tipo: "preventivo",
      descricao: "Teste tendencia 1",
      endereco: "Rua Teste, 3",
      contatoFiacao: "sim",
      iaAnalysis: {
        saude_geral: "regular",
        risco_queda: "baixo",
        recomendacoes: [],
      },
    });

    const chamado1 = await caller.chamado.getById({ id: result1.id });
    expect(chamado1.tendencia).toBe(5);

    // Teste 2: Recomenda remoção + sem fiação = tendencia 4
    const result2 = await caller.chamado.create({
      tipo: "preventivo",
      descricao: "Teste tendencia 2",
      endereco: "Rua Teste, 4",
      contatoFiacao: "nao",
      iaAnalysis: {
        saude_geral: "regular",
        risco_queda: "baixo",
        recomendacoes: ["remoção da árvore"],
      },
    });

    const chamado2 = await caller.chamado.getById({ id: result2.id });
    expect(chamado2.tendencia).toBe(4);

    // Teste 3: Recomenda tratamento + sem fiação = tendencia 3
    const result3 = await caller.chamado.create({
      tipo: "preventivo",
      descricao: "Teste tendencia 3",
      endereco: "Rua Teste, 5",
      contatoFiacao: "nao",
      iaAnalysis: {
        saude_geral: "regular",
        risco_queda: "baixo",
        recomendacoes: ["tratamento fitossanitário"],
      },
    });

    const chamado3 = await caller.chamado.getById({ id: result3.id });
    expect(chamado3.tendencia).toBe(3);

    // Teste 4: Sem recomendações + sem fiação = tendencia 2
    const result4 = await caller.chamado.create({
      tipo: "preventivo",
      descricao: "Teste tendencia 4",
      endereco: "Rua Teste, 6",
      contatoFiacao: "nao",
      iaAnalysis: {
        saude_geral: "regular",
        risco_queda: "baixo",
        recomendacoes: [],
      },
    });

    const chamado4 = await caller.chamado.getById({ id: result4.id });
    expect(chamado4.tendencia).toBe(2);
  });

  it("maintains backward compatibility with heuristic GUT", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    // Teste sem IA (heurística padrão)
    const result = await caller.chamado.create({
      tipo: "preventivo",
      descricao: "Teste compatibilidade",
      endereco: "Rua Compatibilidade, 1",
      contatoFiacao: "nao",
    });

    const chamado = await caller.chamado.getById({ id: result.id });

    // Heurística: preventivo = gravidade 3, urgencia 2, tendencia 3
    expect(chamado.gravidade).toBe(3);
    expect(chamado.urgencia).toBe(2);
    expect(chamado.tendencia).toBe(3);
    expect(chamado.gutScore).toBe(3 * 2 * 3); // 18
  });
});
