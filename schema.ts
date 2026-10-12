import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  phone: varchar("phone", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Chamados (service tickets) for tree pruning/removal requests.
 */
export const chamados = mysqlTable("chamados", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tipo: mysqlEnum("tipo", ["preventivo", "urgente"]).notNull(),
  status: mysqlEnum("status", ["aberto", "em_analise", "equipe_deslocamento", "concluido"]).default("aberto").notNull(),
  descricao: text("descricao").notNull(),
  endereco: text("endereco").notNull(),
  subprefeitura: varchar("subprefeitura", { length: 100 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  fotoUrl: text("fotoUrl"),
  fotoUrl2: text("fotoUrl2"),
  fotoUrl3: text("fotoUrl3"),
  iaSaude: varchar("iaSaude", { length: 20 }),
  iaRiscoQueda: varchar("iaRiscoQueda", { length: 20 }),
  iaConfianca: decimal("iaConfianca", { precision: 4, scale: 3 }),
  iaAnalisadoEm: timestamp("iaAnalisadoEm"),
  contatoFiacao: mysqlEnum("contatoFiacao", ["sim", "nao"]).default("nao").notNull(),
  gravidade: int("gravidade").default(1).notNull(),
  urgencia: int("urgencia").default(1).notNull(),
  tendencia: int("tendencia").default(1).notNull(),
  gutScore: int("gutScore").default(1).notNull(),
  observacoesGestor: text("observacoesGestor"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
  deletedAt: timestamp("deletedAt"),
  deletedBy: int("deletedBy"),
  deletionReason: text("deletionReason"),
});

export type Chamado = typeof chamados.$inferSelect;
export type InsertChamado = typeof chamados.$inferInsert;

/**
 * Status history log for chamados.
 */
export const chamadoHistory = mysqlTable("chamado_history", {
  id: int("id").autoincrement().primaryKey(),
  chamadoId: int("chamadoId").notNull(),
  statusAnterior: varchar("statusAnterior", { length: 30 }),
  statusNovo: varchar("statusNovo", { length: 30 }).notNull(),
  observacao: text("observacao"),
  alteradoPor: int("alteradoPor"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChamadoHistory = typeof chamadoHistory.$inferSelect;
export type InsertChamadoHistory = typeof chamadoHistory.$inferInsert;

/**
 * Immutable application audit trail for security-sensitive operations.
 * Metadata must remain minimized and must never contain secrets or raw files.
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId"),
  action: varchar("action", { length: 80 }).notNull(),
  resourceType: varchar("resourceType", { length: 50 }).notNull(),
  resourceId: varchar("resourceId", { length: 64 }),
  outcome: mysqlEnum("outcome", ["success", "failure"]).default("success").notNull(),
  requestId: varchar("requestId", { length: 64 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
