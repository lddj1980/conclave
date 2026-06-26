# SEO Deploy Checklist — conclaveagents.app

Use this checklist before and after every deploy that may affect search indexing.

## Pré-deploy

- [ ] Verificar se `frontend/public/robots.txt` ainda permite indexação (`Allow: /`).
- [ ] Verificar se nenhuma página pública recebeu `noindex` acidentalmente.
- [ ] Verificar se URLs importantes não foram removidas ou alteradas sem redirecionamento 301.
- [ ] Verificar se `frontend/public/sitemap.xml` será regenerado (`npm run seo:generate`).
- [ ] Verificar se `frontend/index.html` mantém canonical e meta tags corretas.

## Pós-deploy (em até 2 dias úteis)

- [ ] Confirmar resposta HTTP 200 para `/robots.txt`, `/` e 2–3 páginas principais.
- [ ] Confirmar que o HTML renderizado contém canonical válido (`https://conclaveagents.app`).
- [ ] Acessar Google Search Console > Inspeção de URL e testar a home.
- [ ] Verificar relatório de Cobertura para novos erros ou exclusões.
- [ ] Reenviar sitemap se houver mudanças significativas de URL.

## Alertas semanais

- [ ] Revisar relatório de Desempenho do Search Console.
- [ ] Se impressões caírem >50% em relação à semana anterior, abrir investigação.

## Escopo protegido

- Nunca indexar ambientes de staging/preview ou áreas logadas.
