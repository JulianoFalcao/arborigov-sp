import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAddress, createScopedRateLimiter, originGuard, securityHeaders } from "./security";

describe("controles de segurança Fase 7", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(securityHeaders({ isHttpsRequest: req => req.get("x-test-https") === "1" }));
    app.use("/api/rest/v1", originGuard({ trustedOrigins: ["https://app.arborigov.sp.gov.br"] }));
    app.get("/api/rest/v1/chamados", (_req, res) => res.status(200).json({ ok: true }));
    app.post("/api/rest/v1/chamados", (_req, res) => res.status(201).json({ ok: true }));
    app.get("/pagina-publica", (_req, res) => res.status(200).send("ok"));
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  it("aplica cabeçalhos e não armazena respostas da API sensível", async () => {
    const response = await fetch(`${baseUrl}/api/rest/v1/chamados`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store, private, max-age=0");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("só envia HSTS quando a camada de transporte confirma HTTPS", async () => {
    const response = await fetch(`${baseUrl}/pagina-publica`, { headers: { "x-test-https": "1" } });
    expect(response.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
  });

  it("nega mutação com Origin externo e aceita correspondência exata da allowlist", async () => {
    const external = await fetch(`${baseUrl}/api/rest/v1/chamados`, {
      method: "POST",
      headers: { Origin: "https://app.arborigov.sp.gov.br.atacante.example" },
    });
    expect(external.status).toBe(403);
    expect(await external.json()).toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });

    const allowed = await fetch(`${baseUrl}/api/rest/v1/chamados`, {
      method: "POST",
      headers: { Origin: "https://app.arborigov.sp.gov.br" },
    });
    expect(allowed.status).toBe(201);
  });

  it("mantém explícita a compatibilidade para request sem Origin", async () => {
    const response = await fetch(`${baseUrl}/api/rest/v1/chamados`, { method: "POST" });
    expect(response.status).toBe(201);
  });

  it("limita por identidade e não agrega clientes anônimos em um bucket de gateway", async () => {
    let now = 1_000;
    const app = express();
    app.use(createScopedRateLimiter({
      scope: "mutacao-fixture",
      key: req => req.get("x-fixture-user") ?? undefined,
      windowMs: 60_000,
      max: 2,
      now: () => now,
    }));
    app.post("/acao", (_req, res) => res.status(204).send());
    const limiterServer = await new Promise<Server>(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const limiterUrl = `http://127.0.0.1:${(limiterServer.address() as AddressInfo).port}/acao`;

    try {
      expect((await fetch(limiterUrl, { method: "POST", headers: { "x-fixture-user": "cidadao-1" } })).status).toBe(204);
      expect((await fetch(limiterUrl, { method: "POST", headers: { "x-fixture-user": "cidadao-1" } })).status).toBe(204);
      expect((await fetch(limiterUrl, { method: "POST", headers: { "x-fixture-user": "cidadao-1" } })).status).toBe(429);
      expect((await fetch(limiterUrl, { method: "POST", headers: { "x-fixture-user": "cidadao-2" } })).status).toBe(204);
      // Sem identidade, a função segue sem bucket global por IP/XFF.
      expect((await fetch(limiterUrl, { method: "POST", headers: { "x-forwarded-for": "198.51.100.55" } })).status).toBe(204);
      now += 60_000;
      expect((await fetch(limiterUrl, { method: "POST", headers: { "x-fixture-user": "cidadao-1" } })).status).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) => limiterServer.close(error => error ? reject(error) : resolve()));
    }
  });

  it("não confia em X-Forwarded-For sem predicado explícito de proxy confiável", () => {
    const request = {
      get: (name: string) => name.toLowerCase() === "x-forwarded-for" ? "198.51.100.55, 10.0.0.2" : undefined,
      socket: { remoteAddress: "127.0.0.1" },
    };
    expect(clientAddress(request as never)).toBe("127.0.0.1");
    expect(clientAddress(request as never, () => true)).toBe("198.51.100.55");
  });
});
