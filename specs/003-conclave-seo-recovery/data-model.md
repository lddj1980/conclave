# Data Model: Recuperação de Visibilidade SEO — conclaveagents.app

## Entities

### Page

Representa uma página pública indexável do `conclaveagents.app`.

| Field | Type | Description |
|-------|------|-------------|
| `url` | string (canonical) | URL canônica completa, ex: `https://conclaveagents.app/discover/games/chess.html` |
| `path` | string | Caminho relativo, ex: `/discover/games/chess.html` |
| `title` | string | Título da página (`<title>`) |
| `metaDescription` | string | Meta description |
| `robotsDirective` | string | Diretiva robots, ex: `index,follow` |
| `isIndexed` | boolean? | Estado de indexação segundo o Search Console |
| `isCanonical` | boolean | Indica se a URL é canônica (não é alternativa/duplicada) |
| `pageType` | enum | `home`, `game`, `doc`, `blog`, `other` |
| `source` | enum | `static`, `generated`, `spa` |
| `lastModified` | ISO date | Data da última modificação conhecida |

### SearchPerformanceRecord

Registro diário de desempenho de busca, importado do Google Search Console.

| Field | Type | Description |
|-------|------|-------------|
| `date` | ISO date | Data do registro |
| `pageUrl` | string | URL da página ou `DOMAIN` para totais |
| `query` | string? | Consulta de busca (opcional; vazio quando agregado por página) |
| `impressions` | number | Impressões |
| `clicks` | number | Cliques |
| `averagePosition` | number | Posição média |

### DeployRecord

Registro de deploy ou alteração que pode ter afetado a visibilidade.

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO datetime | Data/hora do deploy/commit |
| `commitHash` | string | Hash do commit (se disponível) |
| `author` | string | Autor da alteração |
| `changedFiles` | string[] | Lista de arquivos alterados |
| `description` | string | Descrição da mudança |
| `affectsIndexing` | boolean | Indica se a mudança pode afetar indexação (robots, meta tags, URL, redirects, sitemap) |

### CoverageRecord

Status de cobertura/indexação de uma URL no Search Console.

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | URL |
| `status` | enum | `indexed`, `excluded`, `error`, `submitted`, `crawled`, etc. |
| `discoveredAt` | ISO date | Data em que o Google descobriu a URL |
| `lastCheckedAt` | ISO date | Última verificação manual/automática |
| `reason` | string? | Motivo de exclusão ou erro, quando disponível |

### BacklinkRecord

Menção ou backlink conquistado organicamente.

| Field | Type | Description |
|-------|------|-------------|
| `sourceUrl` | string | URL da página que menciona/linka |
| `sourceDomain` | string | Domínio de origem |
| `type` | enum | `editorial`, `directory`, `social`, `guest_post`, `other` |
| `acquiredAt` | ISO date | Data em que a menção foi identificada |
| `isFollow` | boolean? | Indica se o link é `follow` (quando aplicável) |
| `targetPage` | string | URL do conclaveagents.app referenciada |

## Relationships

- Uma **Page** possui zero ou mais **SearchPerformanceRecord**.
- Uma **Page** possui zero ou mais **CoverageRecord**.
- Um **DeployRecord** pode afetar várias **Page**.
- Um **BacklinkRecord** aponta para uma **Page**.

## Notes

- Nenhuma alteração de schema de banco de dados do backend é necessária. Os registros acima são mantidos em planilhas/documentação ou exportados do Search Console durante a execução da feature.
- O identificador natural de `Page` é a URL canônica.
