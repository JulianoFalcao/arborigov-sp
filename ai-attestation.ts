import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const treeAnalysisSchema = z.object({
  saude_geral: z.enum(["crítica", "ruim", "regular", "boa", "excelente"]),
  doencas_detectadas: z.array(z.string()).max(20),
  danos_estruturais: z.array(z.string()).max(20),
  risco_queda: z.enum(["baixo", "médio", "alto", "crítico"]),
  confianca: z.number().min(0).max(1),
  recomendacoes: z.array(z.string().max(300)).max(20),
});

export type TreeAnalysis = z.infer<typeof treeAnalysisSchema>;

const payloadSchema = z.object({
  userId: z.number().int().positive(),
  imageHash: z.string().regex(/^[0-9a-f]{64}$/),
  analysis: treeAnalysisSchema,
  analyzedAt: z.number().int(),
  expiresAt: z.number().int(),
});

const TTL_MS = 15 * 60 * 1000;

function sign(body: string, secret: string) {
  if (!secret) throw new Error("Segredo de assinatura não configurado");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function fingerprint(image: string) {
  return createHash("sha256").update(image).digest("hex");
}

export function issueAnalysisAttestation(options: {
  userId: number;
  image: string;
  analysis: TreeAnalysis;
  secret: string;
  now?: number;
}) {
  const now = options.now ?? Date.now();
  const payload = payloadSchema.parse({
    userId: options.userId,
    imageHash: fingerprint(options.image),
    analysis: treeAnalysisSchema.parse(options.analysis),
    analyzedAt: now,
    expiresAt: now + TTL_MS,
  });
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, options.secret)}`;
}

export function verifyAnalysisAttestation(options: {
  token: string;
  userId: number;
  image: string;
  secret: string;
  now?: number;
}) {
  const [body, signature, extra] = options.token.split(".");
  if (!body || !signature || extra || options.token.length > 8192) {
    throw new Error("Atestação de IA inválida");
  }
  const expected = Buffer.from(sign(body, options.secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error("Assinatura da triagem inválida");
  }
  const payload = payloadSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  const now = options.now ?? Date.now();
  if (payload.userId !== options.userId || payload.imageHash !== fingerprint(options.image)) {
    throw new Error("Triagem não corresponde ao cidadão ou à foto enviada");
  }
  if (payload.expiresAt < now || payload.analyzedAt > now + 60_000) {
    throw new Error("Triagem expirada; analise a foto novamente");
  }
  return payload;
}
