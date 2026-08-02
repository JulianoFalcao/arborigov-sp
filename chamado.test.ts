import { describe, expect, it } from "vitest";
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

function createAnonymousContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("chamado.create - input validation", () => {
  it("rejects creation when description is too short", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.create({
        tipo: "preventivo",
        descricao: "curta",
        endereco: "Rua Teste, 123",
      })
    ).rejects.toThrow();
  });

  it("rejects creation when endereco is too short", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.create({
        tipo: "preventivo",
        descricao: "Árvore com galhos secos ameaçando cair na calçada",
        endereco: "Rua",
      })
    ).rejects.toThrow();
  });

  it("rejects creation with invalid tipo", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.create({
        tipo: "invalido" as any,
        descricao: "Árvore com galhos secos ameaçando cair na calçada",
        endereco: "Rua Teste, 123",
      })
    ).rejects.toThrow();
  });

  it("rejects creation when user is not authenticated", async () => {
    const ctx = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.create({
        tipo: "preventivo",
        descricao: "Árvore com galhos secos ameaçando cair na calçada",
        endereco: "Rua Teste, 123",
      })
    ).rejects.toThrow();
  });
});

describe("chamado.myList - authentication", () => {
  it("rejects unauthenticated access to myList", async () => {
    const ctx = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.chamado.myList()).rejects.toThrow();
  });
});

describe("chamado.listAll - admin access control", () => {
  it("rejects non-admin access to listAll", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.chamado.listAll()).rejects.toThrow();
  });
});

describe("chamado.updateStatus - admin access control", () => {
  it("rejects non-admin access to updateStatus", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.updateStatus({
        chamadoId: 1,
        status: "em_analise",
      })
    ).rejects.toThrow();
  });

  it("rejects invalid status value", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.updateStatus({
        chamadoId: 1,
        status: "invalido" as any,
      })
    ).rejects.toThrow();
  });
});

describe("chamado.updateGUT - admin access control and validation", () => {
  it("rejects non-admin access to updateGUT", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.updateGUT({
        chamadoId: 1,
        gravidade: 3,
        urgencia: 3,
        tendencia: 3,
      })
    ).rejects.toThrow();
  });

  it("rejects GUT values out of range (> 5)", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.updateGUT({
        chamadoId: 1,
        gravidade: 6,
        urgencia: 3,
        tendencia: 3,
      })
    ).rejects.toThrow();
  });

  it("rejects GUT values out of range (< 1)", async () => {
    const ctx = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.chamado.updateGUT({
        chamadoId: 1,
        gravidade: 0,
        urgencia: 3,
        tendencia: 3,
      })
    ).rejects.toThrow();
  });
});

describe("stats - admin access control", () => {
  it("rejects non-admin access to stats.bySubprefeitura", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.stats.bySubprefeitura()).rejects.toThrow();
  });

  it("rejects non-admin access to stats.byStatus", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.stats.byStatus()).rejects.toThrow();
  });

  it("rejects non-admin access to stats.monthly", async () => {
    const ctx = createUserContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.stats.monthly()).rejects.toThrow();
  });
});

describe("auth.me - public access", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.name).toBe("Cidadão Teste");
    expect(result?.role).toBe("user");
  });
});
