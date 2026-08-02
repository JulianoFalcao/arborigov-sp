import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createChamado,
  getChamadosByUser,
  getAllChamados,
  getChamadoById,
  updateChamadoStatus,
  updateChamadoGUT,
  getChamadoHistory,
  getStatsBySubprefeitura,
  getStatsByStatus,
  getStatsByTipo,
  getMonthlyStats,
} from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { invokeLLM } from "./_core/llm";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a gestores" });
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  chamado: router({
    analyzeImage: protectedProcedure
      .input(
        z.object({
          fotoBase64: z.string().min(50, "Foto inválida"),
        })
      )
      .mutation(async ({ input }) => {
        try {
          // Converter base64 para URL de dados para enviar à IA
          const imageUrl = input.fotoBase64.startsWith("data:")
            ? input.fotoBase64
            : `data:image/jpeg;base64,${input.fotoBase64}`;

          // Chamar IA para analisar imagem
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `Você é um especialista em árvores urbanas e análise de saúde de plantas. 
                Analise a imagem fornecida e retorne uma avaliação estruturada em JSON sobre:
                1. Saúde geral da árvore (crítica, ruim, regular, boa, excelente)
                2. Doenças ou infestações detectadas
                3. Danos estruturais visíveis
                4. Risco de queda (baixo, médio, alto, crítico)
                5. Confiança da análise (0-1)
                6. Recomendações de ação
                
                Retorne APENAS um JSON válido, sem markdown ou explicações adicionais.`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Analise esta imagem de árvore e forneça um diagnóstico estruturado.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: imageUrl,
                      detail: "high",
                    },
                  },
                ],
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "tree_analysis",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    saude_geral: {
                      type: "string",
                      enum: ["crítica", "ruim", "regular", "boa", "excelente"],
                      description: "Saúde geral da árvore",
                    },
                    doencas_detectadas: {
                      type: "array",
                      items: { type: "string" },
                      description: "Lista de doenças ou infestações detectadas",
                    },
                    danos_estruturais: {
                      type: "array",
                      items: { type: "string" },
                      description: "Danos estruturais visíveis",
                    },
                    risco_queda: {
                      type: "string",
                      enum: ["baixo", "médio", "alto", "crítico"],
                      description: "Nível de risco de queda",
                    },
                    confianca: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                      description: "Confiança da análise (0-1)",
                    },
                    recomendacoes: {
                      type: "array",
                      items: { type: "string" },
                      description: "Recomendações de ação",
                    },
                  },
                  required: [
                    "saude_geral",
                    "doencas_detectadas",
                    "danos_estruturais",
                    "risco_queda",
                    "confianca",
                    "recomendacoes",
                  ],
                  additionalProperties: false,
                },
              },
            },
          });

          // Extrair resposta JSON
          const content = response.choices[0]?.message?.content;
          if (!content || typeof content !== "string") {
            throw new Error("Resposta inválida da IA");
          }

          const analysis = JSON.parse(content);
          return analysis;
        } catch (error) {
          console.error("Erro ao analisar imagem:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Erro ao analisar imagem com IA",
          });
        }
      }),

    create: protectedProcedure
      .input(
        z.object({
          tipo: z.enum(["preventivo", "urgente"]),
          descricao: z.string().min(10, "Descrição deve ter pelo menos 10 caracteres"),
          endereco: z.string().min(5, "Endereço é obrigatório"),
          subprefeitura: z.string().optional(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
          contatoFiacao: z.enum(["sim", "nao"]).default("nao"),
          fotoBase64: z.string().optional(),
          fotoBase64_2: z.string().optional(),
          fotoBase64_3: z.string().optional(),
          // Análise de IA (opcional)
          iaAnalysis: z.object({
            saude_geral: z.string().optional(),
            risco_queda: z.string().optional(),
            recomendacoes: z.array(z.string()).optional(),
          }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        let fotoUrl: string | null = null;
        let fotoUrl2: string | null = null;
        let fotoUrl3: string | null = null;

        const uploadPhoto = async (base64: string) => {
          const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
          const key = `chamados/${ctx.user.id}/${nanoid()}.jpg`;
          const result = await storagePut(key, buffer, "image/jpeg");
          return result.url;
        };

        if (input.fotoBase64) fotoUrl = await uploadPhoto(input.fotoBase64);
        if (input.fotoBase64_2) fotoUrl2 = await uploadPhoto(input.fotoBase64_2);
        if (input.fotoBase64_3) fotoUrl3 = await uploadPhoto(input.fotoBase64_3);

        // Calcular GUT: usar IA se disponível, caso contrário usar heurística
        let gravidade: number;
        let urgencia: number;
        let tendencia: number;

        if (input.iaAnalysis) {
          // Usar análise de IA para calcular scores
          // Gravidade baseada na saúde geral da árvore
          const saudeMap: Record<string, number> = {
            "crítica": 5,
            "ruim": 4,
            "regular": 3,
            "boa": 2,
            "excelente": 1,
          };
          gravidade = saudeMap[input.iaAnalysis.saude_geral || "regular"] || 3;

          // Urgência baseada no risco de queda
          const riscoMap: Record<string, number> = {
            "crítico": 5,
            "alto": 4,
            "médio": 3,
            "baixo": 2,
          };
          urgencia = riscoMap[input.iaAnalysis.risco_queda || "médio"] || 3;

          // Tendência baseada em recomendações e contato com fiação
          const temRemocao = input.iaAnalysis.recomendacoes?.some(r => 
            r.toLowerCase().includes("remoção")
          ) || false;
          const temTratamento = input.iaAnalysis.recomendacoes?.some(r => 
            r.toLowerCase().includes("tratamento")
          ) || false;
          
          tendencia = input.contatoFiacao === "sim" ? 5 : (temRemocao ? 4 : temTratamento ? 3 : 2);
        } else {
          // Heurística padrão (sem IA)
          gravidade = input.tipo === "urgente" ? 5 : 3;
          urgencia = input.tipo === "urgente" ? 5 : 2;
          tendencia = input.contatoFiacao === "sim" ? 5 : 3;
        }

        const id = await createChamado({
          userId: ctx.user.id,
          tipo: input.tipo,
          descricao: input.descricao,
          endereco: input.endereco,
          subprefeitura: input.subprefeitura ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          contatoFiacao: input.contatoFiacao,
          fotoUrl,
          fotoUrl2,
          fotoUrl3,
          gravidade,
          urgencia,
          tendencia,
        });

        return { id, success: true };
      }),

    myList: protectedProcedure.query(async ({ ctx }) => {
      return getChamadosByUser(ctx.user.id);
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const chamado = await getChamadoById(input.id);
        if (!chamado) throw new TRPCError({ code: "NOT_FOUND", message: "Chamado não encontrado" });
        return chamado;
      }),

    getHistory: protectedProcedure
      .input(z.object({ chamadoId: z.number() }))
      .query(async ({ input }) => {
        return getChamadoHistory(input.chamadoId);
      }),

    // Admin routes
    listAll: adminProcedure.query(async () => {
      return getAllChamados();
    }),

    updateStatus: adminProcedure
      .input(
        z.object({
          chamadoId: z.number(),
          status: z.enum(["aberto", "em_analise", "equipe_deslocamento", "concluido"]),
          observacao: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateChamadoStatus(input.chamadoId, input.status, ctx.user.id, input.observacao);
        return { success: true };
      }),

    updateGUT: adminProcedure
      .input(
        z.object({
          chamadoId: z.number(),
          gravidade: z.number().min(1).max(5),
          urgencia: z.number().min(1).max(5),
          tendencia: z.number().min(1).max(5),
          observacoesGestor: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await updateChamadoGUT(input.chamadoId, input.gravidade, input.urgencia, input.tendencia, input.observacoesGestor);
        return { success: true };
      }),
  }),

  stats: router({
    bySubprefeitura: adminProcedure.query(() => getStatsBySubprefeitura()),
    byStatus: adminProcedure.query(() => getStatsByStatus()),
    byTipo: adminProcedure.query(() => getStatsByTipo()),
    monthly: adminProcedure.query(() => getMonthlyStats()),
  }),
});

export type AppRouter = typeof appRouter;
