import { describe, expect, it } from "vitest";
import { issueAnalysisAttestation, verifyAnalysisAttestation, type TreeAnalysis } from "./ai-attestation";

const analysis: TreeAnalysis = {
  saude_geral: "ruim",
  doencas_detectadas: [],
  danos_estruturais: ["galho comprometido"],
  risco_queda: "alto",
  confianca: 0.81,
  recomendacoes: ["vistoria técnica"],
};
const image = "data:image/png;base64,ZXhhbXBsZQ==";
const secret = "segredo-de-teste-nao-produtivo";
const now = 1_790_000_000_000;

function token() {
  return issueAnalysisAttestation({ userId: 42, image, analysis, secret, now });
}

describe("Atestação da análise visual", () => {
  it("aceita somente a foto e o cidadão originais", () => {
    const payload = verifyAnalysisAttestation({ token: token(), userId: 42, image, secret, now: now + 1000 });
    expect(payload.analysis.risco_queda).toBe("alto");
    expect(payload.analysis.confianca).toBe(0.81);
    expect(() => verifyAnalysisAttestation({ token: token(), userId: 43, image, secret, now })).toThrow();
    expect(() => verifyAnalysisAttestation({ token: token(), userId: 42, image: `${image}x`, secret, now })).toThrow();
  });

  it("rejeita assinatura ou diagnóstico alterados", () => {
    const valid = token();
    expect(() => verifyAnalysisAttestation({ token: `${valid}x`, userId: 42, image, secret, now })).toThrow();
    const [body, signature] = valid.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: 42, imageHash: "a".repeat(64), analysis, analyzedAt: now, expiresAt: now + 900000 })).toString("base64url");
    expect(() => verifyAnalysisAttestation({ token: `${forged}.${signature}`, userId: 42, image, secret, now })).toThrow();
    expect(body).toBeTruthy();
  });

  it("expira em 15 minutos e rejeita data futura", () => {
    expect(() => verifyAnalysisAttestation({ token: token(), userId: 42, image, secret, now: now + 900001 })).toThrow();
    expect(() => verifyAnalysisAttestation({ token: token(), userId: 42, image, secret, now: now - 61000 })).toThrow();
  });

  it("valida a faixa de confiança antes de assinar", () => {
    expect(() => issueAnalysisAttestation({ userId: 42, image, analysis: { ...analysis, confianca: 1.5 }, secret, now })).toThrow();
  });
});
