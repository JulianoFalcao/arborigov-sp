import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Controles HTTP de borda para serem montados antes das rotas de API.
 * Não habilita CORS e não deduz origens confiáveis de Host/X-Forwarded-Host.
 */
export type SecurityHeadersOptions = {
  /** Determina se o request chegou por TLS no próprio processo ou por proxy já validado pelo integrador. */
  isHttpsRequest?: (req: Request) => boolean;
  /** Permite adequar a classificação de resposta sensível sem mudar as rotas. */
  isSensitiveRequest?: (req: Request) => boolean;
  hstsMaxAgeSeconds?: number;
};

export type OriginGuardOptions = {
  /** Lista explícita de origins canônicas permitidas, por exemplo https://app.exemplo.gov.br. */
  trustedOrigins: readonly string[];
  /** Métodos que podem alterar estado e precisam da verificação de Origin quando ele existe. */
  unsafeMethods?: readonly string[];
};

export type TrustedProxyPredicate = (req: Request) => boolean;

export type ScopedRateLimitOptions = {
  /** Nome estável da operação protegida; faz cada orçamento ser independente. */
  scope: string;
  /** Chave de identidade obrigatória (usuário, conta de integração etc.). Sem chave, não há limitação. */
  key: (req: Request) => string | undefined;
  windowMs: number;
  max: number;
  /** Limite de buckets em memória para conter abuso por chaves aleatórias. */
  maxEntries?: number;
  /** Injetável apenas para testes determinísticos. */
  now?: () => number;
};

const DEFAULT_UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_SENSITIVE_API = /^\/api\/(?:rest\/v1|trpc)(?:\/|$)/;

function defaultIsHttpsRequest(req: Request): boolean {
  // Não lê X-Forwarded-Proto por padrão: esse cabeçalho só pode ser usado se o
  // integrador configurar um proxy confiável e o passar explicitamente na opção.
  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

function defaultIsSensitiveRequest(req: Request): boolean {
  return DEFAULT_SENSITIVE_API.test(req.originalUrl.split("?", 1)[0] ?? "");
}

/**
 * Define cabeçalhos de proteção de baixo risco. HSTS só sai quando a camada que
 * executa este processo consegue afirmar que a conexão é HTTPS.
 */
export function securityHeaders(options: SecurityHeadersOptions = {}): RequestHandler {
  const isHttpsRequest = options.isHttpsRequest ?? defaultIsHttpsRequest;
  const isSensitiveRequest = options.isSensitiveRequest ?? defaultIsSensitiveRequest;
  const hstsMaxAgeSeconds = options.hstsMaxAgeSeconds ?? 63_072_000;

  if (!Number.isSafeInteger(hstsMaxAgeSeconds) || hstsMaxAgeSeconds < 0) {
    throw new Error("hstsMaxAgeSeconds deve ser um inteiro não negativo");
  }

  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    // Restringe enquadramento e plugins sem impor script-src ao front-end atual.
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

    if (isSensitiveRequest(req)) {
      res.setHeader("Cache-Control", "no-store, private, max-age=0");
      res.setHeader("Pragma", "no-cache");
    }

    if (isHttpsRequest(req)) {
      res.setHeader("Strict-Transport-Security", `max-age=${hstsMaxAgeSeconds}; includeSubDomains`);
    }

    next();
  };
}

/** Normaliza apenas origins HTTP(S) sem caminho, credenciais, query ou fragmento. */
export function normalizeTrustedOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function requireTrustedOrigins(origins: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const origin of origins) {
    const value = normalizeTrustedOrigin(origin);
    if (!value) throw new Error(`Origin confiável inválido: ${origin}`);
    normalized.add(value);
  }
  return normalized;
}

function requestOrigin(req: Request): string | undefined {
  const raw = req.get("origin");
  if (!raw || raw === "null") return undefined;
  // Origin enviado pelo navegador não tem path/query; exigir a forma canônica
  // evita aceitar sufixos ou prefixos como https://sistema.gov.br.atacante.tld.
  const normalized = normalizeTrustedOrigin(raw);
  return normalized === raw ? normalized : undefined;
}

/**
 * Bloqueia mutações cujo Origin informado não consta na allowlist estática.
 * A origem de destino não é construída a partir de Host nem de cabeçalhos
 * encaminhados, que poderiam ser controlados por um cliente em configuração ruim.
 *
 * Este é um controle de defesa em profundidade: requests sem Origin seguem adiante
 * para preservar clientes não-browser. Para sessões por cookie, complemente com
 * token CSRF ou verificação Referer conforme a política de autenticação.
 */
export function originGuard(options: OriginGuardOptions): RequestHandler {
  const trustedOrigins = requireTrustedOrigins(options.trustedOrigins);
  const unsafeMethods = new Set((options.unsafeMethods ?? Array.from(DEFAULT_UNSAFE_METHODS)).map(method => method.toUpperCase()));

  return (req, res, next) => {
    if (!unsafeMethods.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const rawOrigin = req.get("origin");
    if (!rawOrigin) {
      // Ver comentário da função: ausência de Origin não prova same-origin.
      next();
      return;
    }

    const origin = requestOrigin(req);
    if (!origin || !trustedOrigins.has(origin)) {
      res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origem da requisição não permitida" } });
      return;
    }

    next();
  };
}

/**
 * Retorna o IP de cliente somente se a borda comprovadamente for proxy confiável.
 * Sem predicado, ignora X-Forwarded-For em vez de aceitar uma identidade forjada.
 */
export function clientAddress(req: Request, isTrustedProxy?: TrustedProxyPredicate): string | undefined {
  if (isTrustedProxy?.(req)) {
    const forwarded = req.get("x-forwarded-for");
    const first = forwarded?.split(",", 1)[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? undefined;
}

type Bucket = { count: number; resetAt: number };

/**
 * Limitação fixa em memória por operação e identidade. Não usa IP como fallback,
 * pois um gateway/NAT pode agrupar cidadãos diferentes. Para múltiplas instâncias,
 * substitua por armazenamento compartilhado e política operacional própria.
 */
export function createScopedRateLimiter(options: ScopedRateLimitOptions): RequestHandler {
  if (!options.scope.trim()) throw new Error("scope é obrigatório");
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
    throw new Error("windowMs deve ser inteiro positivo");
  }
  if (!Number.isSafeInteger(options.max) || options.max <= 0) {
    throw new Error("max deve ser inteiro positivo");
  }

  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 10_000;

  return (req, res, next) => {
    const identity = options.key(req)?.trim();
    if (!identity) {
      // Não agrega anônimos em um bucket global: isso bloquearia clientes atrás
      // de NAT/gateway. Monte depois da autenticação ou forneça chave de integração.
      next();
      return;
    }

    const current = now();
    for (const [bucketKey, bucket] of Array.from(buckets.entries())) {
      if (bucket.resetAt <= current) buckets.delete(bucketKey);
    }

    const bucketKey = `${options.scope}:${identity}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= current) {
      if (buckets.size >= maxEntries) {
        // Falha aberta e observável é preferível a desalojar silenciosamente uma
        // identidade legítima. O integrador deve monitorar e usar store externo.
        res.setHeader("RateLimit-Policy", `${options.max};w=${Math.ceil(options.windowMs / 1000)}`);
        res.status(503).json({ error: { code: "RATE_LIMIT_CAPACITY", message: "Capacidade de limitação temporariamente esgotada" } });
        return;
      }
      bucket = { count: 0, resetAt: current + options.windowMs };
      buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))));
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Muitas requisições para esta operação" } });
      return;
    }

    next();
  };
}
