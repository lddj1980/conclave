# SEO Audit Log — conclaveagents.app

**Feature**: 003-conclave-seo-recovery  
**Created**: 2026-06-26  
**Status**: Correções aplicadas no repositório — aguardando deploy para produção

## Objetivo

Documentar a investigação, correções e acompanhamento da recuperação de visibilidade orgânica do `conclaveagents.app` após queda detectada em 18/06/2026.

## Linha do tempo

| Data | Evento | Observação |
|------|--------|------------|
| 07/06–17/06/2026 | Site ranqueava em posições 1–7 para consultas de cauda longa | Dados do relatório de especialista |
| 18/06/2026 | Impressões praticamente zeram | Início da queda de visibilidade |
| 26/06/2026 | Início da auditoria e execução do plano | Este log criado |
| 26/06/2026 | Corrigido canonical e adicionado links internos | Alterações no repositório; deploy pendente |

## Hipóteses iniciais

1. Mudança de deploy entre 16 e 18/06 afetou `robots.txt`, meta tags, URLs ou redirecionamentos.
2. Página que ranqueava foi removida ou teve URL alterada sem redirecionamento.
3. Query sazonal/pontual parou de ser buscada.

## Descobertas

### 1. Estado técnico inicial (verificado em 26/06/2026)

- `robots.txt`: `User-agent: *` / `Allow: /` / Sitemap referenciado corretamente.
- `sitemap.xml`: gerado automaticamente por `frontend/scripts/generate-programmatic-seo.mjs`; XML bem formado; contém 19 URLs.
- `frontend/index.html`: meta robots `index,follow` configurado; canonical usava `%VITE_SITE_URL%` não substituído.
- Redirecionamento de `.up.railway.app` para `conclaveagents.app` presente em `frontend/index.html`.
- Respostas HTTP: 200 para `/robots.txt`, `/` e `/discover/games/chess.html`.

### 2. Histórico de deploys/commits (16–18/06/2026)

- Nenhum commit encontrado no intervalo 16/06 a 18/06/2026 no repositório local.
- Último commit antes da queda: `9c1c829` em 15/06/2026 05:42 (-03:00), alterando apenas arquivos do backend (`worldcup-prediction.ts`, `worldcup-scores.ts`).
- **Implicação**: se houve deploy em 17/06, ele provavelmente foi gerado a partir de um commit anterior ou via pipeline de CI/CD sem novo commit. É necessário verificar os logs da plataforma de hospedagem (Railway).

### 3. Inventário de páginas

- 19 páginas públicas indexáveis identificadas em `specs/003-conclave-seo-recovery/data/page-inventory.csv`.
- Todas as páginas de jogos e docs são geradas estaticamente.

### 4. Causa raiz identificada

- **Problema técnico confirmado**: a home (`frontend/index.html`) estava publicando a tag canônica como `href="%VITE_SITE_URL%"` literal, ou seja, a variável de ambiente não estava sendo substituída no build de produção.
- **Impacto**: o Google recebia uma URL canônica inválida para a home, o que pode ter causado a perda de confiança/posicionamento das páginas.
- **Outras hipóteses**: ainda é necessário verificar o Search Console (Cobertura/Inspeção de URL) e logs da plataforma de hospedagem para descartar bloqueios adicionais.

### 5. Ações aplicadas

- Criado workspace de auditoria (`seo-audit-log.md`, `data/`).
- Verificado estado técnico inicial de `robots.txt`, `sitemap.xml` e respostas HTTP.
- Exportado histórico de commits para análise.
- Corrigido `frontend/index.html`: substituídas todas as ocorrências de `%VITE_SITE_URL%` por `https://conclaveagents.app` (canonical, Open Graph e schema.org).
- Adicionado `<noscript>` com links estáticos para catálogo e docs em `frontend/index.html`.
- Adicionada seção "Explore More Conclave Games" nas páginas de jogos geradas (`frontend/scripts/generate-programmatic-seo.mjs`), criando links internos entre jogos.
- Regenerado `frontend/public/sitemap.xml` com `lastmod` atualizado.
- Criado checklist de deploy SEO (`seo-deploy-checklist.md`) e rotina de monitoramento (`data/monitoring-schedule.md`).
- Documentado processo de verificação SEO no `frontend/README.md`.

### 6. Validação local

- Build do gerador de SEO executado com sucesso (`npm run seo:generate`).
- Todas as URLs do sitemap retornam HTTP 200.
- HTML gerado contém links contextuais entre páginas de jogos.
- A versão em produção ainda reflete o canonical quebrado (`%VITE_SITE_URL%`) até que o deploy seja realizado.

### 7. Reindexação solicitada

- *Aguardando ação manual: fazer deploy das correções e solicitar reindexação da home via Google Search Console.*

### 8. Resultados pós-correção

- *Preencher após reindexação e monitoramento no Search Console (mínimo 14 dias).* |

## Lições aprendidas

- Variáveis de ambiente usadas em `index.html` devem ter fallback ou ser hardcoded para produção, pois uma substituição falha gera canonical inválido e prejudica indexação.
- Monitoramento pós-deploy de SEO deve incluir verificação do canonical renderizado e do relatório de Cobertura.
