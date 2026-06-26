# Quickstart: Validação da Recuperação de Visibilidade SEO

## Objetivo

Validar que o `conclaveagents.app` voltou a ser indexado e ranqueado após as correções da queda de visibilidade detectada em 18/06/2026.

## Pré-requisitos

- Acesso de proprietário ao Google Search Console da propriedade `https://conclaveagents.app`.
- Acesso ao repositório e ao histórico de deploys/commits.
- URL da aplicação publicada com `VITE_SITE_URL=https://conclaveagents.app`.
- `curl` ou equivalente para verificar respostas HTTP.

## Cenários de validação

### 1. Verificar se não há bloqueio técnico ativo

```bash
curl -I https://conclaveagents.app/robots.txt
curl -I https://conclaveagents.app/
curl -I https://conclaveagents.app/discover/games/chess.html
```

**Esperado**:
- HTTP 200 para todas as URLs.
- `robots.txt` contém `User-agent: *`, `Allow: /` e referência ao sitemap.
- Nenhum header `X-Robots-Tag: noindex` nas respostas.

### 2. Inspecionar a home no Search Console

1. Acesse Google Search Console > **Inspeção de URL**.
2. Insira `https://conclaveagents.app/`.
3. Verifique se o veredito é **"URL está no Google"**.
4. Caso não esteja, aplique a correção identificada e clique em **"Solicitar indexação"**.

### 3. Validar o sitemap

Acesse `https://conclaveagents.app/sitemap.xml`.

**Esperado**:
- XML bem formado.
- Presença das URLs principais: `/`, `/discover/index.html`, `/discover/games/*.html`, `/docs/*.html`.
- URLs canônicas usando `https://conclaveagents.app`.

### 4. Verificar métricas de recuperação

No Search Console, relatório **Desempenho**, filtre para 14 dias após a data da correção.

**Esperado**:
- Impressões diferentes de zero em pelo menos 5 dias dentro da janela de 14 dias (SC-001).
- Posição média ≤10 para as consultas que antes ranqueavam entre 1 e 7, dentro de 21 dias (SC-002).
- Pelo menos 1 clique orgânico por semana dentro de 30 dias (SC-003).

### 5. Verificar linkagem interna

Use um crawler local (Screaming Frog, Sitebulb) ou um script que liste links internos apontando para páginas prioritárias.

**Esperado**:
- Cada página prioritária recebe pelo menos um link contextual de outra página relevante.
- Não há links para ambientes de staging/preview/áreas logadas em páginas públicas.

### 6. Acompanhar menções externas

Execute buscas periódicas por:

```text
"conclaveagents.app"
"Conclave Arena" "agent" "MCP"
"Conclave" "Model Context Protocol"
```

**Esperado**: pelo menos 2 novas menções/editoriais no nicho de agentes de IA dentro de 60 dias (SC-005).

### 7. Verificar rotina de monitoramento pós-deploy

Após qualquer deploy que altere `robots.txt`, meta tags, estrutura de URL ou remoção de páginas:

1. Aguarde o deploy ser concluído.
2. Dentro de 2 dias úteis, verifique no Search Console:
   - Inspeção de URL das páginas alteradas.
   - Relatório de Cobertura para novos erros/exclusões.

**Esperado**: 100% dos deploys com impacto em indexação são verificados em até 2 dias úteis (SC-004).

## Rollback

Se as correções piorarem as métricas de busca:

1. Reverta o commit ou a alteração correspondente.
2. Valide que `robots.txt` e meta tags voltaram ao estado anterior.
3. Solicite reindexação das URLs afetadas via Search Console.
4. Documente a causa no log de deploy/alterações.
