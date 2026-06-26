# Contract: Search Console Report

## Purpose

Define o formato mínimo dos dados exportados do Google Search Console para alimentar o diagnóstico, o acompanhamento e o monitoramento da recuperação de SEO do `conclaveagents.app`.

## Scope

Este contrato é usado pelos artefatos `research.md`, `data-model.md` e `quickstart.md`. Ele padroniza como os dados brutos do Search Console devem ser representados antes da análise, independentemente de serem exportados manualmente via UI, via API ou via planilha.

## Schema

```json
{
  "siteUrl": "https://conclaveagents.app",
  "reportType": "performance | coverage | url-inspection",
  "dateRange": {
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD"
  },
  "rows": [
    {
      "url": "https://conclaveagents.app/",
      "query": "conclave agents",
      "impressions": 1,
      "clicks": 0,
      "position": 3.0
    }
  ]
}
```

### Field descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `siteUrl` | string | yes | Domínio canônico monitorado. Deve ser `https://conclaveagents.app`. |
| `reportType` | enum | yes | Tipo do relatório: `performance`, `coverage` ou `url-inspection`. |
| `dateRange.start` | ISO date | yes | Início do período. |
| `dateRange.end` | ISO date | yes | Fim do período. |
| `rows` | array | yes | Lista de registros. Pode estar vazio, mas nunca nulo. |
| `rows[].url` | string | yes | URL completa analisada. |
| `rows[].query` | string | no | Consulta de busca (apenas para `performance`). |
| `rows[].impressions` | number | yes | Total de impressões. |
| `rows[].clicks` | number | yes | Total de cliques. |
| `rows[].position` | number | no | Posição média (apenas para `performance` e `url-inspection`). |

## Validation rules

1. `siteUrl` deve ser exatamente `https://conclaveagents.app`.
2. `dateRange` não pode exceder 16 meses quando `reportType` for `performance`.
3. `dateRange.end` deve ser maior ou igual a `dateRange.start`.
4. Cada item de `rows` deve conter pelo menos `url` e `impressions`.
5. `reportType` deve ser um dos valores permitidos.

## Failure modes

- Dados fora do formato devem ser normalizados antes da análise.
- Se `rows` estiver vazio, o relatório ainda é válido, mas deve ser interpretado como "sem dados no período".
- URLs fora do domínio `conclaveagents.app` devem ser descartadas ou sinalizadas como fora de escopo.
