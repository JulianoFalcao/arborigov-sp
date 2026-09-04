import { Router, type NextFunction, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { z, ZodError } from "zod";
import type { User } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import {
  createAuditLog,
  createChamado,
  getAllChamados,
  getChamadoById,
  getChamadoHistory,
  getChamadosByUser,
  getChamadosForStatistics,
  listAuditLogs,
  softDeleteChamado,
  updateChamadoDetails,
  updateChamadoGUT,
  updateChamadoStatus,
} from "./db";
import { buildStatisticalReport } from "./statistics";
import { calculateGutScores } from "./risk";

type RestRequest = Request & {
  authUser?: User;
  requestId?: string;
};

type ContextFactory = (req: Request) => Promise<User | null>;

const defaultContextFactory: ContextFactory = async req => {
  try {
    return await sdk.authenticateRequest(req);
  } catch {
    return null;
  }
};

const chamadoCreateSchema = z.object({
  tipo: z.enum(["preventivo", "urgente"]),
  descricao: z.string().trim().min(10).max(4000),
  endereco: z.string().trim().min(5).max(500),
  subprefeitura: z.string().trim().max(100).optional(),
  latitude: z.string().regex(/^-?\d{1,3}(\.\d{1,7})?$/).optional(),
  longitude: z.string().regex(/^-?\d{1,3}(\.\d{1,7})?$/).optional(),
  contatoFiacao: z.enum(["sim", "nao"]).default("nao"),
});

const chamadoUpdateSchema = chamadoCreateSchema.partial().refine(
  value => Object.keys(value).length > 0,
  "Informe ao menos um campo para atualização"
);

const statusSchema = z.object({
  status: z.enum(["aberto", "em_analise", "equipe_deslocamento", "concluido"]),
  observacao: z.string().trim().min(3).max(1000),
});

const gutSchema = z.object({
  gravidade: z.number().int().min(1).max(5),
  urgencia: z.number().int().min(1).max(5),
  tendencia: z.number().int().min(1).max(5),
  observacoesGestor: z.string().trim().min(3).max(2000),
});

const deleteSchema = z.object({
  motivo: z.string().trim().min(5).max(500),
});

function asyncRoute(
  handler: (req: RestRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: RestRequest, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function sendError(
  req: RestRequest,
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  return res.status(status).json({
    error: { code, message, ...(details ? { details } : {}) },
    requestId: req.requestId,
  });
}

function parseId(req: RestRequest, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    sendError(req, res, 400, "INVALID_ID", "Identificador de chamado inválido");
    return null;
  }
  return id;
}

function canAccessChamado(user: User, chamado: { userId: number }) {
  return user.role === "admin" || chamado.userId === user.id;
}

function baseChamadoDto(chamado: Awaited<ReturnType<typeof getChamadoById>>) {
  if (!chamado) return null;
  const { userId, deletedAt, deletedBy, deletionReason, ...visible } = chamado;
  return visible;
}

function citizenChamadoDto(chamado: Awaited<ReturnType<typeof getChamadoById>>) {
  const base = baseChamadoDto(chamado);
  if (!base) return null;
  const { observacoesGestor, ...citizenVisible } = base;
  return citizenVisible;
}

function adminChamadoDto(chamado: Awaited<ReturnType<typeof getChamadoById>>) {
  return baseChamadoDto(chamado);
}

function chamadoDtoFor(user: User, chamado: Awaited<ReturnType<typeof getChamadoById>>) {
  return user.role === "admin" ? adminChamadoDto(chamado) : citizenChamadoDto(chamado);
}

async function audit(params: {
  user: User;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  outcome?: "success" | "failure";
}) {
  try {
    await createAuditLog({
      actorUserId: params.user.id,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      requestId: params.requestId ?? null,
      outcome: params.outcome ?? "success",
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  } catch (error) {
    console.error("[Audit] Failed to persist event", error);
  }
}

export function createRestRouter(contextFactory: ContextFactory = defaultContextFactory) {
  const router = Router();

  router.use((req: RestRequest, res, next) => {
    req.requestId = req.header("x-request-id")?.slice(0, 64) || `req_${nanoid(16)}`;
    res.setHeader("x-request-id", req.requestId);
    next();
  });

  router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "arborigov-rest", version: "v1" });
  });

  router.use(asyncRoute(async (req, res, next) => {
    const user = await contextFactory(req);
    if (!user) {
      sendError(req, res, 401, "UNAUTHORIZED", "Autenticação necessária");
      return;
    }
    req.authUser = user;
    next();
  }));

  router.get("/chamados", asyncRoute(async (req, res) => {
    const user = req.authUser!;
    const data = user.role === "admin"
      ? (await getAllChamados()).map(item => ({
          chamado: adminChamadoDto(item.chamado),
          solicitante: { nome: item.userName ?? "Não informado" },
        }))
      : (await getChamadosByUser(user.id)).map(citizenChamadoDto);
    res.status(200).json({ data, count: data.length, requestId: req.requestId });
  }));

  router.post("/chamados", asyncRoute(async (req, res) => {
    const user = req.authUser!;
    const input = chamadoCreateSchema.parse(req.body);
    const { gravidade, urgencia, tendencia } = calculateGutScores(input);
    const id = await createChamado({
      userId: user.id,
      tipo: input.tipo,
      descricao: input.descricao,
      endereco: input.endereco,
      subprefeitura: input.subprefeitura ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      contatoFiacao: input.contatoFiacao,
      gravidade,
      urgencia,
      tendencia,
    });
    await audit({
      user,
      action: "CHAMADO_CREATED",
      resourceType: "chamado",
      resourceId: String(id),
      requestId: req.requestId,
    });
    res.location(`/api/rest/v1/chamados/${id}`).status(201).json({
      data: chamadoDtoFor(user, await getChamadoById(id)),
      requestId: req.requestId,
    });
  }));

  router.get("/chamados/:id", asyncRoute(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const user = req.authUser!;
    const chamado = await getChamadoById(id);
    if (!chamado) {
      sendError(req, res, 404, "NOT_FOUND", "Chamado não encontrado");
      return;
    }
    if (!canAccessChamado(user, chamado)) {
      sendError(req, res, 403, "FORBIDDEN", "Acesso negado a este chamado");
      return;
    }
    if (user.role === "admin") {
      await audit({
        user,
        action: "SENSITIVE_RECORD_VIEWED",
        resourceType: "chamado",
        resourceId: String(id),
        requestId: req.requestId,
      });
    }
    res.status(200).json({ data: chamadoDtoFor(user, chamado), requestId: req.requestId });
  }));

  router.patch("/chamados/:id", asyncRoute(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const user = req.authUser!;
    const chamado = await getChamadoById(id);
    if (!chamado) {
      sendError(req, res, 404, "NOT_FOUND", "Chamado não encontrado");
      return;
    }
    if (!canAccessChamado(user, chamado)) {
      sendError(req, res, 403, "FORBIDDEN", "Acesso negado a este chamado");
      return;
    }
    if (user.role !== "admin" && chamado.status !== "aberto") {
      sendError(req, res, 409, "INVALID_STATE", "Somente chamados abertos podem ser editados pelo cidadão");
      return;
    }
    const input = chamadoUpdateSchema.parse(req.body);
    const updateData: Parameters<typeof updateChamadoDetails>[1] = { ...input };
    if (input.tipo !== undefined || input.contatoFiacao !== undefined) {
      const tipo = input.tipo ?? chamado.tipo;
      const contatoFiacao = input.contatoFiacao ?? chamado.contatoFiacao;
      Object.assign(updateData, calculateGutScores({ tipo, contatoFiacao }));
    }
    const updated = await updateChamadoDetails(id, updateData);
    await audit({
      user,
      action: "CHAMADO_UPDATED",
      resourceType: "chamado",
      resourceId: String(id),
      requestId: req.requestId,
      metadata: { fields: Object.keys(input) },
    });
    res.status(200).json({ data: chamadoDtoFor(user, updated), requestId: req.requestId });
  }));

  router.delete("/chamados/:id", asyncRoute(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const user = req.authUser!;
    const chamado = await getChamadoById(id);
    if (!chamado) {
      sendError(req, res, 404, "NOT_FOUND", "Chamado não encontrado");
      return;
    }
    if (!canAccessChamado(user, chamado)) {
      sendError(req, res, 403, "FORBIDDEN", "Acesso negado a este chamado");
      return;
    }
    if (user.role !== "admin" && chamado.status !== "aberto") {
      sendError(req, res, 409, "INVALID_STATE", "Somente chamados abertos podem ser excluídos pelo cidadão");
      return;
    }
    const { motivo } = deleteSchema.parse(req.body);
    await softDeleteChamado(id, user.id, motivo);
    await audit({
      user,
      action: "CHAMADO_DELETED",
      resourceType: "chamado",
      resourceId: String(id),
      requestId: req.requestId,
      metadata: { motivo },
    });
    res.status(204).send();
  }));

  router.patch("/chamados/:id/status", asyncRoute(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const user = req.authUser!;
    if (user.role !== "admin") {
      sendError(req, res, 403, "FORBIDDEN", "Acesso restrito a gestores");
      return;
    }
    const chamado = await getChamadoById(id);
    if (!chamado) {
      sendError(req, res, 404, "NOT_FOUND", "Chamado não encontrado");
      return;
    }
    const input = statusSchema.parse(req.body);
    await updateChamadoStatus(id, input.status, user.id, input.observacao);
    await audit({
      user,
      action: "CHAMADO_STATUS_CHANGED",
      resourceType: "chamado",
      resourceId: String(id),
      requestId: req.requestId,
      metadata: { anterior: chamado.status, novo: input.status },
    });
    res.status(200).json({ data: adminChamadoDto(await getChamadoById(id)), requestId: req.requestId });
  }));

  router.patch("/chamados/:id/gut", asyncRoute(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const user = req.authUser!;
    if (user.role !== "admin") {
      sendError(req, res, 403, "FORBIDDEN", "Acesso restrito a gestores");
      return;
    }
    const chamado = await getChamadoById(id);
    if (!chamado) {
      sendError(req, res, 404, "NOT_FOUND", "Chamado não encontrado");
      return;
    }
    const input = gutSchema.parse(req.body);
    await updateChamadoGUT(id, input.gravidade, input.urgencia, input.tendencia, input.observacoesGestor);
    await audit({
      user,
      action: "CHAMADO_GUT_CHANGED",
      resourceType: "chamado",
      resourceId: String(id),
      requestId: req.requestId,
      metadata: {
        anterior: { g: chamado.gravidade, u: chamado.urgencia, t: chamado.tendencia },
        novo: { g: input.gravidade, u: input.urgencia, t: input.tendencia },
      },
    });
    res.status(200).json({ data: adminChamadoDto(await getChamadoById(id)), requestId: req.requestId });
  }));

  router.get("/chamados/:id/historico", asyncRoute(async (req, res) => {
    const id = parseId(req, res);
    if (!id) return;
    const user = req.authUser!;
    const chamado = await getChamadoById(id);
    if (!chamado) {
      sendError(req, res, 404, "NOT_FOUND", "Chamado não encontrado");
      return;
    }
    if (!canAccessChamado(user, chamado)) {
      sendError(req, res, 403, "FORBIDDEN", "Acesso negado ao histórico deste chamado");
      return;
    }
    res.status(200).json({ data: await getChamadoHistory(id), requestId: req.requestId });
  }));

  router.get("/auditoria", asyncRoute(async (req, res) => {
    const user = req.authUser!;
    if (user.role !== "admin") {
      sendError(req, res, 403, "FORBIDDEN", "Acesso restrito a gestores");
      return;
    }
    const query = z.object({
      action: z.string().max(80).optional(),
      resourceType: z.string().max(50).optional(),
      resourceId: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const data = await listAuditLogs(query);
    res.status(200).json({ data, count: data.length, requestId: req.requestId });
  }));

  router.get("/relatorios/resumo", asyncRoute(async (req, res) => {
    const user = req.authUser!;
    if (user.role !== "admin") {
      sendError(req, res, 403, "FORBIDDEN", "Acesso restrito a gestores");
      return;
    }
    const report = buildStatisticalReport(await getChamadosForStatistics());
    await audit({
      user,
      action: "REPORT_VIEWED",
      resourceType: "relatorio",
      requestId: req.requestId,
      metadata: { totalRegistros: report.total },
    });
    res.status(200).json({ data: report, requestId: req.requestId });
  }));

  router.use((error: unknown, req: RestRequest, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      sendError(req, res, 400, "VALIDATION_ERROR", "Dados da requisição inválidos", error.issues);
      return;
    }
    console.error(`[REST ${req.requestId}]`, error);
    sendError(req, res, 500, "INTERNAL_ERROR", "Erro interno do servidor");
  });

  return router;
}
