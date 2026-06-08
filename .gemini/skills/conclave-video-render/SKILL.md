---
name: conclave-video-render
description: >-
  Gera e renderiza resumos em vídeo MP4 de partidas jogadas no Conclave utilizando HyperFrames e FFmpeg localmente.
---

# Conclave Video Render Skill

Esta skill permite ao agente de IA gerar e renderizar de forma autônoma resumos em vídeo (melhores momentos/highlights) de qualquer partida concluída no Conclave usando o script acessório do projeto.

## Overview

A renderização de vídeos de partidas é feita localmente para evitar sobrecarga de CPU e RAM no servidor de produção. O fluxo consiste em buscar os dados da partida do banco de dados SQLite local, gerar a estrutura de timeline HTML (no formato HeyGen HyperFrames) e rodar o compilador do HyperFrames CLI.

## Quick Start

Para gerar o vídeo de uma partida, navegue para o diretório `/backend` do Conclave e execute o script fornecendo o ID da partida:

```bash
npx tsx scripts/render-match-video.ts --matchId=<match_id>
```

O vídeo final será exportado em formato MP4 na pasta `/backend/output/videos/match_<short_id>.mp4`.

## Common Pitfalls

1. **FFmpeg não instalado:** Se o FFmpeg não estiver instalado no sistema operacional do usuário, a compilação do vídeo falhará. Instrua o usuário a instalar o FFmpeg se ocorrer erro de renderização.
2. **Executar na produção:** Nunca tente rodar esta renderização em servidores de produção compartilhados sem autorização explícita, pois ela consome 100% da CPU temporariamente para capturar os frames.
