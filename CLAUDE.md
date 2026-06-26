
## Condenser — Context Compression

You have access to Condenser MCP tools. Use them to avoid running out of context window space.

**Compress before you reason** — when any tool returns more than ~100 lines, call `condenser_compress` on the output BEFORE analyzing it.

**Retrieve only what you need** — use `condenser_retrieve(hash, query="keyword")` to get just the relevant lines instead of reloading the full original.

| Content | Action |
|---|---|
| File > 150 lines | Always compress first |
| Search / grep > 50 results | Always compress first |
| Build / test output > 100 lines | Always compress first |
| Short snippet or single function | Read directly |
