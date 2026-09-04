import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import type { User } from "../drizzle/schema";

const dbMocks = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => undefined),
  createChamado: vi.fn(async () => 42),
  getAllChamados: vi.fn(async () => []),
  getChamadoById: vi.fn(),
  getChamadoHistory: vi.fn(async () => []),
  getChamadosByUser: vi.fn(async () => []),
  getChamadosForStatistics: vi.fn(async () => []),
  listAuditLogs: vi.fn(async () => []),
  softDeleteChamado: vi.fn(async () => undefined),
  updateChamadoDetails: vi.fn(),
  updateChamadoGUT: vi.fn(async () => undefined),
  updateChamadoStatus: vi.fn(async () => undefined),
}));

vi.mock("./db", () => dbMocks);

import { createRestRouter } from "./rest";

const citizen: User = {
  id: 7,
  openId: "citizen-rest-test",
  name: "Cidadão Teste",
  email: "cidadao@example.com",
  loginMethod: "test",
  role: "user",
  phone: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSignedIn: new Date("2026-01-01T00:00:00Z"),
};

const admin: User = { ...citizen, id: 1, openId: "admin-rest-test", role: "admin", name: "Gestor Teste" };

const chamado = {
  id: 42,
  userId: citizen.id,
  tipo: "preventivo" as const,
  status: "aberto" as const,
  descricao: "Galhos secos próximos à calçada",
  endereco: "Rua das Árvores, 100",
  subprefeitura: "Pinheiros",
  latitude: null,
  longitude: null,
  fotoUrl: null,
  fotoUrl2: null,
  fotoUrl3: null,
  contatoFiacao: "nao" as const,
  gravidade: 3,
  urgencia: 2,
  tendencia: 3,
  gutScore: 18,
  observacoesGestor: "Anotação interna",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  resolvedAt: null,
  deletedAt: null,
  deletedBy: null,
  deletionReason: null,
};

describe("ArboriGov REST API", () => {
  let server: Server;
  let baseUrl: string;
  let authenticatedUser: User | null = null;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/rest/v1", createRestRouter(async () => authenticatedUser));
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/rest/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  beforeEach(() => {
    authenticatedUser = null;
    vi.clearAllMocks();
    dbMocks.getChamadoById.mockResolvedValue(chamado);
    dbMocks.updateChamadoDetails.mockResolvedValue(chamado);
  });

  it("expõe health check público", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", version: "v1" });
  });

  it("retorna 401 em recurso protegido sem sessão", async () => {
    const response = await fetch(`${baseUrl}/chamados`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("retorna 403 quando cidadão consulta chamado de terceiro", async () => {
    authenticatedUser = citizen;
    dbMocks.getChamadoById.mockResolvedValue({ ...chamado, userId: 999 });
    const response = await fetch(`${baseUrl}/chamados/42`);
    expect(response.status).toBe(403);
  });

  it("minimiza o payload retornado ao cidadão", async () => {
    authenticatedUser = citizen;
    const response = await fetch(`${baseUrl}/chamados/42`);
    const payload = await response.json() as { data: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(payload.data).not.toHaveProperty("userId");
    expect(payload.data).not.toHaveProperty("observacoesGestor");
    expect(payload.data).not.toHaveProperty("deletionReason");
  });

  it("valida o corpo antes de criar chamado", async () => {
    authenticatedUser = citizen;
    const response = await fetch(`${baseUrl}/chamados`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "preventivo", descricao: "curta" }),
    });
    expect(response.status).toBe(400);
    expect(dbMocks.createChamado).not.toHaveBeenCalled();
  });

  it("recalcula GUT quando tipo ou contato com fiação muda", async () => {
    authenticatedUser = citizen;
    const response = await fetch(`${baseUrl}/chamados/42`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "urgente", contatoFiacao: "sim" }),
    });
    expect(response.status).toBe(200);
    expect(dbMocks.updateChamadoDetails).toHaveBeenCalledWith(42, expect.objectContaining({
      gravidade: 5,
      urgencia: 5,
      tendencia: 5,
      gutScore: 125,
    }));
  });

  it("restringe auditoria a gestores e retorna dados ao administrador", async () => {
    authenticatedUser = citizen;
    expect((await fetch(`${baseUrl}/auditoria`)).status).toBe(403);

    authenticatedUser = admin;
    dbMocks.listAuditLogs.mockResolvedValue([{ id: 1, action: "CHAMADO_CREATED" }]);
    const response = await fetch(`${baseUrl}/auditoria`);
    const payload = await response.json() as { count: number };
    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
  });

  it("executa exclusão lógica e retorna 204", async () => {
    authenticatedUser = citizen;
    const response = await fetch(`${baseUrl}/chamados/42`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: "Registro enviado em duplicidade" }),
    });
    expect(response.status).toBe(204);
    expect(dbMocks.softDeleteChamado).toHaveBeenCalledWith(42, citizen.id, "Registro enviado em duplicidade");
  });
});
