import { eq, desc, sql, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  chamados,
  InsertChamado,
  chamadoHistory,
  auditLogs,
  InsertAuditLog,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ==================== USER QUERIES ====================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== CHAMADO QUERIES ====================

export async function createChamado(data: InsertChamado) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const gutScore = (data.gravidade ?? 1) * (data.urgencia ?? 1) * (data.tendencia ?? 1);
  const result = await db.insert(chamados).values({ ...data, gutScore });
  const insertId = result[0].insertId;
  // Log initial status
  await db.insert(chamadoHistory).values({
    chamadoId: insertId,
    statusNovo: "aberto",
    observacao: "Chamado criado pelo cidadão",
    alteradoPor: data.userId,
  });
  return insertId;
}

export async function getChamadosByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chamados)
    .where(and(eq(chamados.userId, userId), isNull(chamados.deletedAt)))
    .orderBy(desc(chamados.createdAt));
}

export async function getAllChamados() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    chamado: chamados,
    userName: users.name,
  }).from(chamados)
    .leftJoin(users, eq(chamados.userId, users.id))
    .where(isNull(chamados.deletedAt))
    .orderBy(desc(chamados.gutScore), desc(chamados.createdAt));
}

export async function getChamadoById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chamados)
    .where(and(eq(chamados.id, id), isNull(chamados.deletedAt)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateChamadoDetails(
  chamadoId: number,
  data: Partial<Pick<InsertChamado,
    | "tipo"
    | "descricao"
    | "endereco"
    | "subprefeitura"
    | "latitude"
    | "longitude"
    | "contatoFiacao"
    | "gravidade"
    | "urgencia"
    | "tendencia"
    | "gutScore"
  >>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chamados).set(data)
    .where(and(eq(chamados.id, chamadoId), isNull(chamados.deletedAt)));
  return getChamadoById(chamadoId);
}

export async function softDeleteChamado(
  chamadoId: number,
  deletedBy: number,
  deletionReason: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chamados).set({
    deletedAt: new Date(),
    deletedBy,
    deletionReason,
  }).where(and(eq(chamados.id, chamadoId), isNull(chamados.deletedAt)));
}

export async function updateChamadoStatus(
  chamadoId: number,
  newStatus: "aberto" | "em_analise" | "equipe_deslocamento" | "concluido",
  alteradoPor: number,
  observacao?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const current = await getChamadoById(chamadoId);
  if (!current) throw new Error("Chamado not found");

  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === "concluido") {
    updateData.resolvedAt = new Date();
  }
  await db.update(chamados).set(updateData).where(eq(chamados.id, chamadoId));

  await db.insert(chamadoHistory).values({
    chamadoId,
    statusAnterior: current.status,
    statusNovo: newStatus,
    observacao: observacao ?? null,
    alteradoPor,
  });
}

export async function updateChamadoGUT(
  chamadoId: number,
  gravidade: number,
  urgencia: number,
  tendencia: number,
  observacoesGestor?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const gutScore = gravidade * urgencia * tendencia;
  await db.update(chamados).set({
    gravidade,
    urgencia,
    tendencia,
    gutScore,
    observacoesGestor: observacoesGestor ?? null,
  }).where(eq(chamados.id, chamadoId));
}

export async function getChamadoHistory(chamadoId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(chamadoHistory)
    .where(eq(chamadoHistory.chamadoId, chamadoId))
    .orderBy(desc(chamadoHistory.createdAt));
}

export async function getStatsBySubprefeitura() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    subprefeitura: chamados.subprefeitura,
    total: sql<number>`count(*)`.as("total"),
    abertos: sql<number>`sum(case when ${chamados.status} != 'concluido' then 1 else 0 end)`.as("abertos"),
    concluidos: sql<number>`sum(case when ${chamados.status} = 'concluido' then 1 else 0 end)`.as("concluidos"),
    urgentes: sql<number>`sum(case when ${chamados.tipo} = 'urgente' then 1 else 0 end)`.as("urgentes"),
  }).from(chamados)
    .where(isNull(chamados.deletedAt))
    .groupBy(chamados.subprefeitura);
}

export async function getStatsByStatus() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    status: chamados.status,
    total: sql<number>`count(*)`.as("total"),
  }).from(chamados)
    .where(isNull(chamados.deletedAt))
    .groupBy(chamados.status);
}

export async function getStatsByTipo() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    tipo: chamados.tipo,
    total: sql<number>`count(*)`.as("total"),
  }).from(chamados)
    .where(isNull(chamados.deletedAt))
    .groupBy(chamados.tipo);
}

export async function getMonthlyStats() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    month: sql<string>`DATE_FORMAT(${chamados.createdAt}, '%Y-%m')`.as("month"),
    total: sql<number>`count(*)`.as("total"),
    concluidos: sql<number>`sum(case when ${chamados.status} = 'concluido' then 1 else 0 end)`.as("concluidos"),
  }).from(chamados)
    .where(isNull(chamados.deletedAt))
    .groupBy(sql`DATE_FORMAT(${chamados.createdAt}, '%Y-%m')`)
    .orderBy(sql`DATE_FORMAT(${chamados.createdAt}, '%Y-%m')`);
}

export async function getChamadosForStatistics() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: chamados.id,
    status: chamados.status,
    tipo: chamados.tipo,
    subprefeitura: chamados.subprefeitura,
    gutScore: chamados.gutScore,
    createdAt: chamados.createdAt,
    resolvedAt: chamados.resolvedAt,
  }).from(chamados)
    .where(isNull(chamados.deletedAt));
}

// ==================== AUDIT QUERIES ====================

export async function createAuditLog(data: InsertAuditLog) {
  const db = await getDb();
  if (!db) {
    console.warn("[Audit] Database not available; event was not persisted", data.action);
    return;
  }
  await db.insert(auditLogs).values(data);
}

export async function listAuditLogs(options?: {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const filters = [];
  if (options?.action) filters.push(eq(auditLogs.action, options.action));
  if (options?.resourceType) filters.push(eq(auditLogs.resourceType, options.resourceType));
  if (options?.resourceId) filters.push(eq(auditLogs.resourceId, options.resourceId));

  const query = db.select({
    id: auditLogs.id,
    actorUserId: auditLogs.actorUserId,
    action: auditLogs.action,
    resourceType: auditLogs.resourceType,
    resourceId: auditLogs.resourceId,
    outcome: auditLogs.outcome,
    requestId: auditLogs.requestId,
    metadata: auditLogs.metadata,
    createdAt: auditLogs.createdAt,
    actorName: users.name,
  }).from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(options?.limit ?? 50, 100))
    .offset(Math.max(options?.offset ?? 0, 0));

  return query;
}
