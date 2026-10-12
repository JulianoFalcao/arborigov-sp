# Product Backlog e desenho técnico — ArboriGov SP

## Product Backlog revisado

| ID | Prioridade | User story | Valor público |
|---|---:|---|---|
| US-01 | Alta | Como cidadão autenticado, quero registrar um chamado com descrição, endereço, localização e fotos para comunicar um risco arbóreo. | Amplia a participação cidadã e melhora a qualidade da informação recebida. |
| US-02 | Alta | Como cidadão, quero consultar somente os meus chamados e seus históricos para acompanhar o atendimento sem expor dados de terceiros. | Garante transparência com proteção de dados pessoais. |
| US-03 | Alta | Como gestor, quero consultar uma fila ordenada por GUT para priorizar ocorrências com maior risco. | Apoia decisões operacionais e reduz riscos urbanos. |
| US-04 | Alta | Como gestor, quero alterar status e prioridade de chamados com justificativa para manter rastreabilidade das decisões. | Reforça prestação de contas e governança. |
| US-05 | Alta | Como integrador autorizado, quero consumir uma API RESTful versionada para conectar o ArboriGov a outros serviços públicos. | Facilita interoperabilidade e evolução do ecossistema GovTech. |
| US-06 | Alta | Como administrador, quero consultar trilhas de auditoria para investigar operações sensíveis. | Permite responsabilização e detecção de uso indevido. |
| US-07 | Média | Como gestor, quero visualizar estatísticas descritivas e taxas operacionais para planejar equipes e recursos. | Transforma registros operacionais em informação gerencial. |
| US-08 | Média | Como cidadão, quero receber diagnóstico assistido por IA ao anexar uma foto para melhorar a triagem inicial. | Torna o relato mais completo e reduz esforço de classificação. |
| US-09 | Média | Como usuário, quero receber validações claras ao enviar arquivos para evitar formatos ou tamanhos inadequados. | Reduz falhas, riscos e custos de armazenamento. |
| US-10 | Baixa | Como gestor, quero exportar um relatório sem dados pessoais desnecessários para compartilhar indicadores com outras áreas. | Apoia transparência com minimização de dados. |

## Critérios de aceitação prioritários

| User story | Critérios de aceitação |
|---|---|
| US-01 | O sistema exige autenticação; valida descrição e endereço; aceita no máximo três imagens; rejeita conteúdo inválido; armazena somente as URLs dos arquivos; retorna confirmação e identificador do chamado. |
| US-02 | Um cidadão recebe apenas chamados vinculados ao seu `userId`; tentativa de acesso a chamado de terceiro retorna `403`; gestor autorizado pode consultar qualquer chamado; o histórico respeita a mesma regra. |
| US-03 | A fila administrativa é ordenada por `gutScore` decrescente e, em caso de empate, por data de criação; a resposta informa posição e classificação de prioridade. |
| US-04 | Apenas administradores alteram status ou GUT; a requisição inválida retorna `400`; recurso ausente retorna `404`; a alteração bem-sucedida gera histórico funcional e evento de auditoria. |
| US-05 | A API usa prefixo `/api/rest/v1`; responde JSON; emprega métodos HTTP coerentes; retorna códigos `200`, `201`, `204`, `400`, `401`, `403`, `404` e `500`; erros seguem um envelope padronizado. |
| US-06 | Somente administradores consultam auditoria; cada evento registra ator, ação, recurso, identificador, resultado e data; dados secretos, imagens em base64 e conteúdo pessoal completo não são armazenados. |
| US-07 | O relatório apresenta total, taxa de resolução, média, mediana, desvio-padrão do GUT, distribuição por status/tipo/região e tempo médio de resolução quando houver dados suficientes. |
| US-09 | A interface informa tipos aceitos e limite; o servidor valida novamente; arquivo inválido não é persistido; erros são exibidos de modo compreensível. |

## Contrato da API RESTful

Todas as rotas ficam sob `/api/rest/v1`, usam sessão OAuth por cookie e retornam `application/json`, exceto respostas `204 No Content`.

| Método | Rota | Perfil | Finalidade | Respostas principais |
|---|---|---|---|---|
| GET | `/health` | Público | Verificar disponibilidade sem expor dados internos | `200` |
| GET | `/chamados` | Cidadão/gestor | Listar próprios chamados ou todos, conforme perfil | `200`, `401` |
| POST | `/chamados` | Cidadão/gestor | Criar chamado | `201`, `400`, `401` |
| GET | `/chamados/:id` | Dono/gestor | Consultar detalhe autorizado | `200`, `403`, `404` |
| PATCH | `/chamados/:id` | Dono, enquanto aberto | Atualizar campos permitidos | `200`, `400`, `403`, `409` |
| DELETE | `/chamados/:id` | Dono, enquanto aberto; gestor | Realizar exclusão lógica | `204`, `403`, `404`, `409` |
| PATCH | `/chamados/:id/status` | Gestor | Alterar status com justificativa | `200`, `400`, `403`, `404` |
| PATCH | `/chamados/:id/gut` | Gestor | Atualizar GUT e observação técnica | `200`, `400`, `403`, `404` |
| GET | `/chamados/:id/historico` | Dono/gestor | Consultar histórico funcional | `200`, `403`, `404` |
| GET | `/relatorios/resumo` | Gestor | Obter indicadores e estatísticas descritivas | `200`, `403` |
| GET | `/auditoria` | Gestor | Consultar trilha com paginação e filtros | `200`, `400`, `403` |

### Envelope de erro

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados da requisição inválidos",
    "details": []
  },
  "requestId": "req_01H..."
}
```

## Perfis e permissões

| Perfil | Criar chamado | Consultar próprios dados | Consultar todos | Alterar status/GUT | Ver auditoria | Acessa dados pessoais |
|---|---:|---:|---:|---:|---:|---|
| Visitante | Não | Não | Não | Não | Não | Não |
| Cidadão (`user`) | Sim | Sim | Não | Não | Não | Somente os próprios dados necessários ao atendimento |
| Gestor (`admin`) | Sim | Sim | Sim | Sim | Sim | Nome do solicitante e dados operacionais necessários |

## Modelo de auditoria

| Operação | Evento | Motivo do registro | Dados mínimos |
|---|---|---|---|
| Criação de chamado | `CHAMADO_CREATED` | Evidenciar origem e momento da solicitação | ator, recurso, ID, resultado, data |
| Consulta de detalhe administrativo | `SENSITIVE_RECORD_VIEWED` | Detectar acesso indevido a dados de cidadão | ator, recurso, ID, resultado, data |
| Alteração de status | `CHAMADO_STATUS_CHANGED` | Rastrear decisão operacional | ator, ID, status anterior/novo, data |
| Alteração GUT | `CHAMADO_GUT_CHANGED` | Justificar mudança de prioridade | ator, ID, valores anteriores/novos, data |
| Exportação de relatório | `REPORT_EXPORTED` | Controlar saída de informação | ator, filtros, quantidade, data |
| Exclusão lógica | `CHAMADO_DELETED` | Preservar responsabilização | ator, ID, motivo, data |

> A trilha de auditoria não deve armazenar cookies, tokens, imagens em base64, senhas, conteúdo integral de documentos ou cópias desnecessárias de dados pessoais.

## Logs técnicos e registros de auditoria

| Aspecto | Log técnico | Registro de auditoria |
|---|---|---|
| Objetivo | Diagnóstico, desempenho e disponibilidade | Responsabilização e conformidade |
| Público principal | Desenvolvimento e operações | Segurança, governança e gestores autorizados |
| Exemplo | Erro de conexão, latência e stack trace | Gestor alterou status do chamado 42 |
| Retenção | Definida pela necessidade operacional | Definida pela política de governança |
| Conteúdo pessoal | Deve ser minimizado | Somente o estritamente necessário para evidência |

## Estruturas de dados aplicadas

O sistema usa **listas** para coleções paginadas de chamados e eventos; uma **fila de prioridade** lógica para ordenar chamados pelo produto GUT; e um **histórico sequencial** de eventos para representar a evolução do atendimento. Pilhas não são necessárias ao fluxo principal, mas o conceito de LIFO pode ser empregado para desfazer alterações em uma sessão administrativa sem substituir a trilha oficial persistida.
