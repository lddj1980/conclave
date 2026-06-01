# Catalog Sync (Local -> Production)

This sync is incremental and safe for production history:
- Upserts approved games (`GameSpecification`)
- Upserts HouseBots (`Agent` where owner = `HouseBot`)
- Syncs HouseBot profiles, scoreboards, and subscriptions
- Does **not** delete matches/rounds/actions

## 1) Prerequisites

1. Local DB running and populated (`SOURCE_DATABASE_URL`)
2. Railway backend DB URL (`TARGET_DATABASE_URL`)
3. Latest schema applied on target:

```bash
npm run prisma:generate
npm run prisma:push
```

## 2) Run sync

From `backend/`:

```bash
$env:SOURCE_DATABASE_URL="postgresql://local_user:local_pass@localhost:5432/conclave"
$env:TARGET_DATABASE_URL="postgresql://railway_user:railway_pass@host:port/railway"
npm run sync:catalog
```

The script prints JSON summary and whether `chess` is approved in target.

## 3) Verify quickly

1. Open production UI.
2. Check game selector contains `Chess`.
3. Confirm HouseBots list includes chess bots (`ChessRandomWhiteBot`, `ChessRandomBlackBot`).
4. Call API:

```bash
curl https://<backend>/api/games
```

## 4) Routine recommendation

- Run this sync whenever new approved games/bots are introduced locally.
- Keep full data migration (`export/import`) only for one-time bootstrap environments.
