# Auditoria de requisitos — consolidação técnica do ArboriGov SP

## Síntese executiva

O ArboriGov SP já possui uma base funcional com autenticação, perfis `user` e `admin`, cadastro e acompanhamento de chamados, priorização GUT, upload de fotos, análise de imagens por IA, dashboards gerenciais e testes automatizados. A nova atividade exige ampliar essa base com uma API RESTful explícita, auditoria transversal, estatísticas descritivas mais completas, documentação acadêmica e materiais finais de apresentação.

## Matriz de conformidade

| Requisito | Evidência atual | Lacuna identificada | Ação planejada |
|---|---|---|---|
| Evolução do projeto | Aplicação React, tRPC, banco MySQL, IA e dashboards | Falta relato consolidado da evolução | Produzir documento final com comparação entre versões |
| Backlog | `todo.md` mantém histórico técnico | Faltam user stories acadêmicas e critérios de aceitação | Criar backlog formal por prioridade |
| API RESTful | Existe API tipada via tRPC | Não há rotas REST com métodos e status HTTP documentados | Implementar `/api/rest/v1` com CRUD de chamados |
| CRUD principal | Create, read e updates existem via tRPC | Exclusão controlada e CRUD REST não existem | Adicionar atualização geral e exclusão lógica segura |
| Integração front-end | React consome tRPC | Não há evidência de consumo REST | Criar cliente REST e integrar fluxo demonstrável |
| Estruturas de dados | Listas de chamados e ordenação por GUT | Conceitos de lista, fila e prioridade não estão explicitados | Implementar e documentar fila priorizada e estatísticas |
| Relatórios | Gráficos por status, tipo e subprefeitura | Faltam média, mediana, dispersão, taxa de resolução e interpretação | Criar endpoint e painel estatístico ampliado |
| Controle de acesso | OAuth, `protectedProcedure` e regra de administrador | Falta política REST uniforme e matriz formal de permissões | Criar middleware REST e tabela de perfis/permissões |
| Auditoria | Histórico de alteração de status | Não cobre consulta sensível, alteração GUT, exportação e exclusão | Criar tabela e serviço de eventos de auditoria |
| Proteção de dados | Rotas autenticadas e armazenamento externo de fotos | Falta minimização explícita de respostas e documentação de risco | Criar DTOs públicos/administrativos e mascaramento |
| Testes | 29 testes Vitest existentes | Faltam testes REST, auditoria e relatórios | Ampliar suíte automatizada |
| Documentação final | Materiais de fases anteriores | Falta documento específico desta atividade e README | Criar README, documento consolidado, PDFs e pitch |

## Decisões de arquitetura

O tRPC continuará sendo o canal interno principal para preservar a tipagem entre React e servidor. Paralelamente, será disponibilizada uma API RESTful versionada em `/api/rest/v1`, baseada nos mesmos serviços de domínio e helpers de banco. Essa separação evita duplicação de regras e fornece evidência objetiva de métodos HTTP, status codes, validação e tratamento padronizado de erros.

As operações destrutivas serão implementadas como **exclusão lógica**, preservando rastreabilidade. A auditoria será armazenada separadamente do histórico funcional do chamado: o histórico descreve a evolução do atendimento, enquanto a trilha de auditoria registra quem realizou uma operação sensível, quando, sobre qual recurso e com qual resultado.

## Riscos técnicos encontrados

O procedimento `chamado.getById` atual verifica autenticação, mas não comprova que um cidadão somente acessa seus próprios chamados. O endpoint REST deverá corrigir esse risco e a regra equivalente deverá ser aplicada ao tRPC. Além disso, a atualização GUT não gera registro de auditoria e o retorno administrativo inclui dados de usuário sem uma política explícita de minimização. Esses pontos serão tratados antes da geração dos materiais finais.
