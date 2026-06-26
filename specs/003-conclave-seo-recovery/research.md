# Research: Recuperação de Visibilidade SEO — conclaveagents.app

## Decisions

### 1. Escopo de auditoria de páginas

- **Decision**: Auditar todas as páginas públicas indexáveis do domínio `conclaveagents.app`.
- **Rationale**: Clarificação do usuário na sessão `2026-06-26`. Garante que nenhuma página que tenha ranqueado anteriormente seja ignorada durante a investigação.
- **Alternatives considered**:
  - Apenas a home page — risco de ignorar a página que de fato ranqueou.
  - Home + páginas lançadas próximo a 07/06 — dependia de lista desconhecida e poderia deixar de fora páginas de docs/blog.
  - Definir durante a investigação — menos testável e poderia alongar o escopo de forma imprevisível.

### 2. Fonte de verdade para diagnóstico

- **Decision**: Usar o Google Search Console (Cobertura, Inspeção de URL e relatório de Desempenho) como fonte primária de dados.
- **Rationale**: É a ferramenta citada no relatório de especialista e a única fonte oficial de dados de indexação, impressões, cliques e posição do Google.
- **Alternatives considered**:
  - Rank trackers de terceiros — não têm acesso ao índice do Google nem à cobertura oficial.
  - Logs do servidor — úteis para verificar crawls, mas não mostram posições nem impressões.

### 3. Pipeline de SEO programático existente

- **Decision**: Reutilizar e, se necessário, ajustar o script `frontend/scripts/generate-programmatic-seo.mjs` para gerar/manter páginas estáticas.
- **Rationale**: O script já gera páginas estáticas com title, meta description, canonical, schema markup, breadcrumb, FAQ e sitemap. Ajustes nele têm baixo esforço e alto impacto.
- **Alternatives considered**:
  - Criar páginas manualmente — não escala e dificulta manutenção.
  - Migrar o frontend para SSR/SSR híbrido — esforço muito alto para esta fase de recuperação e não resolve a causa raiz imediata.

### 4. Estratégia de link building

- **Decision**: Apenas menções/editoriais orgânicas; excluir pagamento por links, diretórios pagos, PBNs e outras práticas contra as diretrizes dos mecanismos de busca.
- **Rationale**: Clarificação do usuário na sessão `2026-06-26`. Em um site em recuperação de visibilidade, táticas arriscadas podem agravar a situação em vez de recuperá-la.
- **Alternatives considered**:
  - Guest posts não pagos — aceitável, mas manter estritamente orgânico reduz risco e simplifica aprovação.
  - Compra de backlinks — descartado por risco de penalização.

### 5. Exclusões de escopo

- **Decision**: Manter fora do escopo staging, preview, ambientes de teste e áreas logadas.
- **Rationale**: Clarificação do usuário na sessão `2026-06-26`. Protege páginas internas e evita indexação acidental ou alterações em ambientes que não devem ser descobertos.
- **Alternatives considered**:
  - Incluir todas as URLs publicadas — descartado por risco operacional.
  - Deferir a definição para o planejamento — agora está explicitamente documentada.

### 6. Abordagem de reindexação

- **Decision**: Após correções, solicitar reindexação via ferramenta de Inspeção de URL do Google Search Console, página por página afetada, em vez de aguardar apenas o crawl natural.
- **Rationale**: Acelera o feedback e permite medir os critérios de sucesso dentro das janelas de 14/21/30 dias.
- **Alternatives considered**:
  - Apenas reenviar o sitemap — não garante reprocessamento imediato de URLs bloqueadas previamente.

## Unknowns Remaining

- A causa exata da queda de visibilidade só poderá ser confirmada durante a investigação de deploys e do Search Console.
- Quais consultas específicas geraram as posições 1–7 entre 07/06 e 17/06 serão obtidas no relatório de Desempenho do Search Console (filtro por página/URL).
