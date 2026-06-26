# Feature Specification: Recuperação de Visibilidade SEO — conclaveagents.app

**Feature Branch**: `[003-conclave-seo-recovery]`

**Created**: 26 de junho de 2026

**Status**: Draft

**Input**: User description: "vamos montar um plano para atender aos itens de SEO elencados no @seo/Relatorio_SEO_Especialista_Aprofundado.docx referente ao conclaveagents.app"

## Clarifications

### Session 2026-06-26

- Q: Quais páginas devem ser tratadas como candidatas a terem ranqueado e precisam passar por inspeção/reindexação? → A: C — Todas as páginas públicas indexáveis do domínio devem ser auditadas.
- Q: Quais táticas de conquista de menções/links externos são aceitáveis para o conclaveagents.app? → A: A — Apenas menções editoriais orgânicas (outreach para blogs, podcasts, comunidades).
- Q: Existe alguma página ou seção do conclaveagents.app que deve permanecer fora do escopo de alterações ou indexação durante esta iniciativa? → A: C — Staging, preview, ambientes de teste e áreas logadas devem ser excluídos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Diagnosticar e Reverter a Queda de Visibilidade (Priority: P1)

Como responsável de marketing/produto, quero identificar por que o conclaveagents.app perdeu visibilidade orgânica após 17/06/2026 e corrigir a causa, para que o site volte a ser encontrado nos resultados de busca.

**Why this priority**: O relatório de SEO mostra que o domínio chegou a rankear nas posições 1 a 7 entre 07/06 e 17/06 e praticamente desapareceu depois. Sem reverter essa queda, nenhuma outra ação de SEO gera retorno.

**Independent Test**: Pode ser validado verificando os dados do console de busca (cobertura/inspeção de URL) e confirmando que as impressões retornam após a correção.

**Acceptance Scenarios**:

1. **Given** que o site obteve posições 1 a 7 entre 07/06 e 17/06, **when** a equipe revisar os deploys e o relatório de cobertura entre 16 e 18/06, **then** a causa raiz da perda de visibilidade será identificada e documentada.
2. **Given** que foi encontrada uma causa técnica ou de conteúdo, **when** as correções forem aplicadas, **then** as páginas afetadas passarão na inspeção de URL e poderão ser reenviadas para indexação.

---

### User Story 2 — Reintegrar Páginas nos Resultados de Busca (Priority: P1)

Como visitante em busca de soluções de agentes de IA, quero encontrar o conclaveagents.app nos resultados de busca, para poder descobrir o produto.

**Why this priority**: A recuperação só é concluída quando o público começa a ver o site novamente nos resultados orgânicos e consegue clicar.

**Independent Test**: Pode ser validado pelo console de busca mostrando impressões diferentes de zero e melhora na posição média.

**Acceptance Scenarios**:

1. **Given** que as correções foram publicadas, **when** o mecanismo de busca processar o reenvio, **then** haverá impressões registradas em pelo menos 5 dias dentro de uma janela de 14 dias.
2. **Given** as consultas que antes ranqueavam entre 1 e 7, **when** o site for reindexado, **then** a posição média retornará a ≤10 dentro de 21 dias.

---

### User Story 3 — Fortalecer Autoridade e Linkagem (Priority: P2)

Como responsável de crescimento/SEO, quero reforçar a linkagem interna e conquistar menções externas, para que o site ganhe autoridade e estabilize suas posições.

**Why this priority**: Com volume baixo de impressões, qualquer ganho de autoridade e sinais de confiança do nicho de agentes de IA tem efeito desproporcionalmente positivo.

**Independent Test**: Pode ser validado por auditoria de links internos e pela contagem de menções/backlinks externos obtidos.

**Acceptance Scenarios**:

1. **Given** que as páginas-chave foram identificadas, **when** a linkagem interna for melhorada, **then** cada página prioritária receberá pelo menos um link contextual de outra página relevante.
2. **Given** que uma ação de divulgação é executada, **when** medido após 60 dias, **then** pelo menos 2 novas menções ou backlinks autoritários no nicho de agentes de IA terão sido conquistados.

---

### User Story 4 — Monitoramento Contínuo (Priority: P3)

Como equipe de produto, quero monitorar o desempenho de busca após cada deploy, para detectar problemas de visibilidade dentro de 48 horas.

**Why this priority**: A queda anterior coincidiu com o período de 16 a 18/06, o que sugere que mudanças publicadas podem ter causado o problema. Monitorar evita que o erro se repita.

**Independent Test**: Pode ser validado por uma rotina documentada de monitoramento e um gatilho de alerta.

**Acceptance Scenarios**:

1. **Given** que ocorre um deploy, **when** ele alterar regras de acesso a mecanismos de busca, meta tags, estrutura de URL ou remoção de páginas, **then** a equipe verificará o console de busca em até 2 dias úteis.
2. **Given** relatórios semanais de busca, **when** as métricas forem revisadas, **then** qualquer queda superior a 50% nas impressões acionará uma investigação.

---

### Edge Cases

- O que acontece se a causa raiz for uma consulta sazonal/pontual que simplesmente parou de ser buscada? A equipe deve pivotar para identificar e otimizar consultas recorrentes e sustentáveis.
- O que acontece se a propriedade do console de busca ou o domínio público real estiverem configurados incorretamente? A propriedade correta deve ser verificada antes de qualquer outra ação de SEO.
- O que acontece se nenhuma mudança de deploy for encontrada? A equipe deve investigar fatores externos (atualizações do mecanismo de busca, ações manuais, concorrência) e documentar as conclusões.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir acesso ao histórico de deploys/alterações entre 16 e 18/06/2026 e ao relatório de cobertura do console de busca para o conclaveagents.app.
- **FR-002**: O sistema MUST identificar e documentar qualquer alteração que removeu páginas, trocou URLs sem redirecionamento ou bloqueou a indexação de páginas que antes ranqueavam.
- **FR-003**: O sistema MUST corrigir o bloqueador técnico ou de conteúdo identificado e validar a correção por inspeção de URL antes de solicitar reindexação.
- **FR-004**: O sistema MUST solicitar reavaliação/reindexação das páginas afetadas através da ferramenta de inspeção de URL do mecanismo de busca após as correções.
- **FR-005**: O sistema MUST melhorar a linkagem interna para que todas as páginas públicas indexáveis do domínio — com ênfase na home e nas páginas de produto/funcionalidade lançadas próximo a 07/06 — sejam alcançáveis por links contextuais de outras páginas relevantes.
- **FR-006**: O sistema MUST executar uma iniciativa de divulgação/link-building orgânico, direcionada a pelo menos 5 fontes relevantes do nicho de agentes de IA, para conquistar menções editoriais ou backlinks naturais, excluindo pagamento por links, diretórios pagos e outras práticas contra as diretrizes dos mecanismos de busca.
- **FR-007**: O sistema MUST estabelecer uma rotina de monitoramento que verifique o console de busca em até 2 dias úteis após qualquer deploy que afete regras de acesso a mecanismos de busca, meta tags, estrutura de URL ou remoção de páginas.

### Key Entities *(include if feature involves data)*

- **Registro de Desempenho de Busca**: Impressões, posição média e cliques diários do domínio e de URLs individuais.
- **Log de Deploy/Alterações**: Registro datado de publicações, commits ou mudanças de configuração que afetem páginas públicas.
- **Status de Cobertura**: Estado de indexação de cada URL no mecanismo de busca (indexada, excluída, erro etc.).
- **Página Prioritária**: Qualquer página pública indexável do domínio; a home e as páginas lançadas próximo a 07/06 têm prioridade maior por terem maior probabilidade de terem ranqueado anteriormente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O console de busca deve registrar impressões diferentes de zero em pelo menos 5 dias dentro dos 14 dias seguintes à correção.
- **SC-002**: A posição média das consultas que antes ranqueavam entre 1 e 7 deve retornar a ≤10 dentro de 21 dias após a reindexação.
- **SC-003**: O site deve receber pelo menos 1 clique orgânico por semana dentro de 30 dias após a correção.
- **SC-004**: 100% dos deploys que possam afetar a indexação em mecanismos de busca devem ser verificados no console de busca em até 2 dias úteis.
- **SC-005**: Pelo menos 2 novas menções ou backlinks autoritários no nicho de agentes de IA devem ser conquistados dentro de 60 dias.

## Assumptions

- A propriedade do console de busca para o conclaveagents.app está configurada corretamente e a equipe possui acesso de administrador/proprietário.
- A queda de visibilidade foi causada por uma mudança sob controle da equipe (deploy, conteúdo ou URL) e não por uma atualização ampla do algoritmo do mecanismo de busca.
- Nenhuma migração de domínio ou rebranding de grande porte está planejado durante o período de recuperação.
- A equipe tem acesso aos logs de deploy, histórico de controle de versão e logs de resposta do servidor.
- Ambientes de staging/preview, URLs de teste e áreas logadas estão fora do escopo desta iniciativa e não devem ser alterados nem indexados.
