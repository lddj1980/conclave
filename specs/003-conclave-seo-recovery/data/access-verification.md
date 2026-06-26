# Access Verification Checklist

## Google Search Console

- [ ] Acessar https://search.google.com/search-console como proprietário da propriedade `https://conclaveagents.app`.
- [ ] Confirmar que os relatórios de **Desempenho**, **Cobertura** e **Inspeção de URL** estão disponíveis.
- [ ] Verificar se a propriedade correta é `https://conclaveagents.app` (não um domínio de staging/Railway).

## Repositório e deploy

- [x] Acesso ao repositório Git confirmado (`git rev-parse --git-dir` retorna `.git`).
- [ ] Acesso ao painel de hospedagem (Railway/Vercel/etc.) para verificar deploys de 16–18/06/2026.
- [ ] Acesso aos logs de build/deploy da plataforma de hospedagem.

## Domínio e DNS

- [ ] Confirmar que `conclaveagents.app` aponta para o ambiente de produção correto.
- [ ] Confirmar que `lastro-production.up.railway.app` ou outras URLs de staging não estão sendo indexadas como canônicas.
