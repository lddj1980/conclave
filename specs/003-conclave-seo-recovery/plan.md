# Implementation Plan: Recuperação de Visibilidade SEO — conclaveagents.app

**Branch**: `[003-conclave-seo-recovery]` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-conclave-seo-recovery/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Implementar ações de SEO técnico e autoridade para recuperar a visibilidade orgânica do `conclaveagents.app` após a queda detectada em 18/06/2026. O trabalho divide-se em:

1. Investigação da causa raiz via histórico de deploys/commits e Google Search Console.
2. Correção de bloqueadores técnicos e solicitação de reindexação.
3. Fortalecimento da linkagem interna entre páginas estáticas e a SPA.
4. Aquisição de menções editoriais orgânicas no nicho de agentes de IA.
5. Monitoramento contínuo pós-deploy para evitar nova queda.

## Technical Context

**Language/Version**: TypeScript 5.x / 6.x, Node.js, React 19

**Primary Dependencies**: Vite (frontend), Express + Prisma (backend)

**Storage**: PostgreSQL/SQLite via Prisma (backend); arquivos estáticos em `frontend/public/`

**Testing**: Nenhum framework de teste configurado explicitamente; validação via builds (`npm run build`), inspeção de URLs e métricas do Search Console

**Target Platform**: Web (frontend estático + backend Node.js)

**Project Type**: Web application (frontend + backend)

**Performance Goals**: Páginas estáticas devem carregar em menos de 3 segundos em conexão doméstica comum; a home (SPA) deve manter Core Web Vitals dentro dos limites do Search Console

**Constraints**:

- As páginas de SEO programático são geradas em `frontend/public/` pelo script `frontend/scripts/generate-programmatic-seo.mjs`.
- `robots.txt`, `sitemap.xml` e as meta tags da home ficam em `frontend/public/` e `frontend/index.html`.
- O domínio canônico é controlado pela variável de ambiente `VITE_SITE_URL`.
- Não são permitidas táticas de link building pagas ou contra as diretrizes dos mecanismos de busca (clarificação do usuário).
- Staging, preview, ambientes de teste e áreas logadas estão fora do escopo (clarificação do usuário).

**Scale/Scope**: Aproximadamente 20 páginas de jogos geradas + páginas de docs/blog em `frontend/content/`; todas as páginas públicas indexáveis do domínio estão no escopo de auditoria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `constitution.md` do projeto ainda é um template sem princípios ratificados. Nenhum gate ativo foi violado. Os critérios de sucesso da especificação permanecem mensuráveis e sem detalhes de implementação.

## Project Structure

### Documentation (this feature)

```text
specs/003-conclave-seo-recovery/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
frontend/
├── index.html           # Meta tags, schema e canonical da home
├── public/
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── discover/        # Páginas estáticas de SEO programático
│   └── docs/            # Páginas de documentação estáticas
├── scripts/
│   └── generate-programmatic-seo.mjs
└── src/
    └── App.tsx          # SPA principal (não indexável como página isolada)

backend/
├── src/
│   ├── routes/          # APIs REST
│   └── ...
└── prisma/
    └── schema.prisma
```

**Structure Decision**: Aplicação web com frontend estático gerado pelo Vite e backend Node.js/Express. As ações de SEO concentram-se no frontend (`index.html`, `public/`, script de geração) e na configuração de deploy/infraestrutura (robots, redirecionamentos, respostas HTTP). Não há alteração na arquitetura geral.

## Complexity Tracking

Nenhuma violação de complexidade identificada. Esta feature é predominantemente de auditoria, configuração e processo, não introduzindo novos componentes de software complexos.
