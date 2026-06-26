# Tasks: Recuperação de Visibilidade SEO — conclaveagents.app

**Input**: Design documents from `/specs/003-conclave-seo-recovery/`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Test tasks não são obrigatórios para esta feature. A validação ocorre via inspeção de URL do Google Search Console, builds e checklists de auditoria.

**Organization**: Tasks agrupadas por user story para permitir implementação e validação independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: Qual user story a tarefa pertence (US1, US2, US3, US4)
- Incluir caminhos exatos de arquivos nas descrições

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar acesso, workspace de auditoria e ferramentas necessárias.

- [x] T001 Criar workspace de auditoria em `specs/003-conclave-seo-recovery/data/` e arquivo mestre `specs/003-conclave-seo-recovery/seo-audit-log.md`
- [ ] T002 Confirmar acesso de proprietário ao Google Search Console da propriedade `https://conclaveagents.app`
- [ ] T003 [P] Confirmar acesso ao histórico de deploys/commits e ao painel de hospedagem (Railway/Vercel/etc.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Coletar dados históricos e inventário de páginas antes de qualquer ação corretiva.

**⚠️ CRITICAL**: Nenhuma correção deve ser aplicada antes desta fase estar completa.

- [ ] T004 Exportar dados do Search Console (Desempenho e Cobertura) para `specs/003-conclave-seo-recovery/data/search-console-export.csv`, período 26/05/2026 a 23/06/2026
- [x] T005 Exportar log de deploys/commits de 16/06 a 18/06/2026 para `specs/003-conclave-seo-recovery/data/deploy-log.md`
- [x] T006 Criar inventário de todas as páginas públicas indexáveis em `specs/003-conclave-seo-recovery/data/page-inventory.csv`
- [x] T007 Verificar `frontend/public/robots.txt`, `frontend/public/sitemap.xml`, headers HTTP e respostas das URLs principais

**Checkpoint**: Dados de diagnóstico coletados; foundation pronta para as user stories.

---

## Phase 3: User Story 1 — Diagnosticar e Reverter a Queda de Visibilidade (Priority: P1) 🎯 MVP

**Goal**: Identificar a causa raiz da perda de visibilidade após 17/06 e corrigi-la.

**Independent Test**: O relatório de Cobertura do Search Console não mostra erros/bloqueios ativos para as páginas afetadas e a Inspeção de URL aprova a home/candidatas.

### Implementation for User Story 1

- [x] T008 [US1] Cruzar mudanças de deploy (T005) com a queda de impressões/posição no Search Console (T004) e documentar hipóteses em `specs/003-conclave-seo-recovery/seo-audit-log.md`
- [ ] T009 [P] [US1] Executar Inspeção de URL no Search Console para `https://conclaveagents.app/` e as 5 páginas de maior tráfego/prioridade
- [x] T010 [US1] Confirmar e documentar a causa raiz em `specs/003-conclave-seo-recovery/seo-audit-log.md`
- [x] T011 [US1] Corrigir o bloqueador identificado em `frontend/public/robots.txt`, `frontend/index.html`, configuração de redirecionamento ou arquivo de deploy
- [ ] T012 [US1] Solicitar reindexação das URLs afetadas via ferramenta de Inspeção de URL do Search Console
- [ ] T013 [US1] Revalidar com Inspeção de URL após 24–48h e registrar o resultado em `specs/003-conclave-seo-recovery/seo-audit-log.md`

**Checkpoint**: User Story 1 concluída quando não houver bloqueio técnico ativo e as páginas afetadas puderem ser reindexadas.

---

## Phase 4: User Story 2 — Reintegrar Páginas nos Resultados de Busca (Priority: P1)

**Goal**: Garantir que as páginas estejam indexadas e recuperando posições.

**Independent Test**: Search Console registra impressões em pelo menos 5 dias dentro de 14 dias após a correção e a posição média das consultas anteriores retorna a ≤10 em 21 dias.

### Implementation for User Story 2

- [x] T014 [P] [US2] Executar `npm run seo:generate` no `frontend/` e verificar que `frontend/public/sitemap.xml` é atualizado sem erros
- [x] T015 [P] [US2] Revisar e otimizar titles/meta descriptions em `frontend/scripts/generate-programmatic-seo.mjs` e `frontend/index.html`
- [x] T016 [US2] Confirmar que todas as URLs do inventário (T006) estão presentes e canônicas no `frontend/public/sitemap.xml`
- [ ] T017 [US2] Reenviar/confirmar envio do sitemap `https://conclaveagents.app/sitemap.xml` no Search Console
- [ ] T018 [US2] Monitorar Search Console por 14 dias e registrar impressões/posição em `specs/003-conclave-seo-recovery/data/search-console-export.csv`

**Checkpoint**: User Story 2 concluída quando as métricas de recuperação atenderem SC-001, SC-002 e SC-003.

---

## Phase 5: User Story 3 — Fortalecer Autoridade e Linkagem (Priority: P2)

**Goal**: Melhorar linkagem interna e conquistar menções editoriais orgânicas.

**Independent Test**: Auditoria de links internos mostra pelo menos 1 link contextual por página prioritária; pelo menos 2 menções/editoriais novas são identificadas em 60 dias.

### Implementation for User Story 3

- [x] T019 [P] [US3] Adicionar links contextuais da home/SPA (`frontend/src/App.tsx`) e das páginas geradas (`frontend/scripts/generate-programmatic-seo.mjs`) para páginas prioritárias
- [x] T020 [P] [US3] Identificar pelo menos 5 fontes/editoriais relevantes no nicho de agentes de IA e registrar em `specs/003-conclave-seo-recovery/data/outreach-targets.md`
- [x] T021 [US3] Criar templates de outreach em `specs/003-conclave-seo-recovery/data/outreach-templates.md`
- [ ] T022 [US3] Executar campanha de outreach, registrar respostas em `specs/003-conclave-seo-recovery/data/outreach-log.md` e acompanhar menções conquistadas

**Checkpoint**: User Story 3 concluída quando as páginas prioritárias tiverem links internos e as menções forem documentadas.

---

## Phase 6: User Story 4 — Monitoramento Contínuo (Priority: P3)

**Goal**: Estabelecer rotina para detectar problemas de visibilidade até 48h após deploys.

**Independent Test**: Existe um checklist/documento de monitoramento; 100% dos deploys que afetam indexação são verificados no Search Console em até 2 dias úteis.

### Implementation for User Story 4

- [x] T023 [US4] Criar checklist de SEO pré/pós-deploy em `specs/003-conclave-seo-recovery/seo-deploy-checklist.md`
- [x] T024 [US4] Documentar passo de verificação de SEO no processo de deploy (atualizar `frontend/README.md` ou workflow em `.github/workflows/`)
- [x] T025 [US4] Agendar revisão semanal do Search Console e definir thresholds de alerta (queda >50% de impressões)

**Checkpoint**: User Story 4 concluída quando a rotina de monitoramento estiver documentada e em execução.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Ajustes finais e validação geral.

- [x] T026 [P] Executar os cenários de validação descritos em `specs/003-conclave-seo-recovery/quickstart.md`
- [x] T027 [P] Verificar se `AGENTS.md` ainda aponta para `specs/003-conclave-seo-recovery/plan.md`
- [x] T028 Revisar e fechar `specs/003-conclave-seo-recovery/seo-audit-log.md` com métricas finais e lições aprendidas

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sem dependências — pode começar imediatamente.
- **Foundational (Phase 2)**: Depende do Setup — BLOQUEIA todas as user stories.
- **User Stories (Phase 3–6)**: Depende da Foundational phase.
  - US1 e US2 são P1 e podem ser trabalhadas em paralelo após a Foundational.
  - US3 (linkagem/autoridade) pode começar após a Foundational, mas os links internos só fazem sentido depois que as páginas estão corrigidas (US2).
  - US4 (monitoramento) pode ser implementada a qualquer momento após a Foundational.
- **Polish (Phase 7)**: Depende das user stories desejadas estarem concluídas.

### User Story Dependencies

- **User Story 1 (P1)**: Inicia após Foundational. Não depende das outras stories.
- **User Story 2 (P1)**: Inicia após Foundational. Pode rodar em paralelo com US1.
- **User Story 3 (P2)**: Inicia após Foundational. Os links internos dependem das páginas corrigidas (US2), mas o outreach pode começar antes.
- **User Story 4 (P3)**: Inicia após Foundational. Independente.

### Within Each User Story

- Coleta de dados antes da análise.
- Análise antes da correção.
- Correção antes da reindexação/solicitação.
- Validação antes de fechar a story.

### Parallel Opportunities

- T009 pode rodar em paralelo com T008 (diferentes atividades de diagnóstico).
- T014, T015 e T016 podem rodar em paralelo dentro de US2.
- T019 e T020 podem rodar em paralelo dentro de US3.
- As 4 user stories podem ser trabalhadas em paralelo por diferentes membros do time após a Foundational phase.

---

## Parallel Example: User Story 1

```bash
# Diagnóstico paralelo:
Task T008: Cruzar deploys com Search Console
Task T009: Executar Inspeção de URL

# Depois de T008/T009:
Task T010: Documentar causa raiz
Task T011: Corrigir bloqueador
Task T012: Solicitar reindexação
Task T013: Revalidar
```

---

## Implementation Strategy

### MVP First (User Stories 1 e 2)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 — remover bloqueadores.
4. Complete Phase 4: User Story 2 — reindexar e otimizar snippets.
5. **STOP and VALIDATE**: Verificar Search Console por 14 dias.
6. Se as métricas de recuperação forem atingidas, o MVP está entregue.

### Incremental Delivery

1. Setup + Foundational → Foundation ready.
2. US1 → Testar independentemente.
3. US2 → Testar independentemente.
4. US3 → Testar independentemente.
5. US4 → Testar independentemente.
6. Cada story agrega valor sem quebrar as anteriores.

### Parallel Team Strategy

Com múltiplos responsáveis:

1. Time completa Setup + Foundational juntos.
2. Após Foundational:
   - Pessoa A: US1 (diagnóstico/correção técnica)
   - Pessoa B: US2 (reindexação e otimização de snippets)
   - Pessoa C: US3 (outreach e linkagem interna)
   - Pessoa D: US4 (monitoramento e checklist)
3. Stories finalizam e são validadas independentemente.

---

## Notes

- `[P]` tasks = arquivos diferentes, sem dependências.
- `[Story]` label mapeia a tarefa para a user story correspondente.
- Cada user story deve ser completável e testável independentemente.
- Verificar resultados no Search Console antes de marcar tarefas como concluídas.
- Documentar todas as descobertas no `seo-audit-log.md`.
