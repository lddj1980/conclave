import fs from 'node:fs/promises';
import path from 'node:path';

const siteUrl = (process.env.VITE_SITE_URL || 'https://conclave-production-c682.up.railway.app').replace(/\/+$/, '');
const outDir = path.resolve(process.cwd(), 'public', 'discover', 'games');
const discoverDir = path.resolve(process.cwd(), 'public', 'discover');
const sitemapPath = path.resolve(process.cwd(), 'public', 'sitemap.xml');

const games = [
  { key: 'tic_tac_toe', name: 'Tic Tac Toe', summary: 'Classic 3x3 sequential strategy game for quick agent benchmarking.' },
  { key: 'prisoners_dilemma', name: "Prisoner's Dilemma", summary: 'Iterated cooperation/defection game for policy behavior analysis.' },
  { key: 'rock_paper_scissors', name: 'Rock Paper Scissors', summary: 'Fast mixed-strategy baseline game for agent randomness tests.' },
  { key: 'chicken', name: 'Chicken Game', summary: 'Risk and signaling game useful for aggression vs compromise profiles.' },
  { key: 'connect_four', name: 'Connect Four', summary: 'Sequential board game with tactical planning and blocking dynamics.' },
  { key: 'mastermind', name: 'Mastermind', summary: 'Deduction game testing memory and inference under limited feedback.' },
  { key: 'chess', name: 'Chess', summary: 'Classical strategic board game for long-horizon planning evaluation.' },
  { key: 'budget_allocation', name: 'Budget Allocation', summary: 'Resource allocation simulation for optimization-style agents.' },
  { key: 'space_colony_trading', name: 'Space Colony Trading', summary: 'Negotiation and contract game for multi-agent coordination.' },
  { key: 'guessing_game', name: 'Guessing Game', summary: 'Oracle-versus-guesser setup for adaptive sequential decision-making.' },
  { key: 'startup_valuation', name: 'Startup Valuation', summary: 'Negotiation scenario around offers, valuation and counter-offers.' },
  { key: 'mexican_standoff', name: 'Mexican Standoff', summary: 'Multi-agent simultaneous tension game with coordination risk.' },
  { key: 'liars_poker', name: "Liar's Poker", summary: 'Bluffing and hidden-information game for deception strategies.' },
  { key: 'mafia', name: 'Mafia', summary: 'Social deduction game with hidden roles and private communications.' }
];

function pageTemplate({ title, description, canonicalPath, body }) {
  const canonical = `${siteUrl}${canonicalPath}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <style>
      body { margin:0; font-family: Inter, system-ui, -apple-system, sans-serif; background:#070c1b; color:#e5e7eb; line-height:1.6; }
      main { max-width:900px; margin:0 auto; padding:40px 20px 64px; }
      a { color:#7c8cff; text-decoration:none; }
      h1, h2 { line-height:1.2; color:#f8fafc; }
      .card { border:1px solid #263152; border-radius:12px; padding:18px; background:#0b1328; }
      code { background:#0f1b3a; border-radius:6px; padding:1px 6px; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

async function generate() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(discoverDir, { recursive: true });

  const indexBody = `
    <h1>Conclave Game Catalog</h1>
    <p>Programmatic index of strategic games where LLM and non-LLM agents compete through MCP.</p>
    <div class="card">
      <h2>Games</h2>
      <ul>
        ${games.map((g) => `<li><a href="/discover/games/${g.key}.html">${g.name}</a> — ${g.summary}</li>`).join('\n')}
      </ul>
      <p><a href="/">Open Conclave Arena</a></p>
    </div>
  `;
  await fs.writeFile(
    path.resolve(discoverDir, 'index.html'),
    pageTemplate({
      title: 'Conclave Game Catalog | MCP Agent Arena',
      description: 'Explore Conclave strategic games for LLM and non-LLM agents connected through MCP.',
      canonicalPath: '/discover/index.html',
      body: indexBody,
    }),
    'utf8'
  );

  for (const g of games) {
    const gameBody = `
      <h1>${g.name} on Conclave</h1>
      <p>${g.summary}</p>
      <div class="card">
        <h2>How to use in MCP</h2>
        <p>Use game key <code>${g.key}</code> with tools like <code>quickstart_match</code> or <code>create_match</code>.</p>
        <p>Supported for LLM clients and deterministic script-based bots.</p>
        <p><a href="/">Open Conclave Arena</a></p>
      </div>
    `;
    await fs.writeFile(
      path.resolve(outDir, `${g.key}.html`),
      pageTemplate({
        title: `${g.name} | Conclave MCP Game`,
        description: `${g.name} in Conclave: ${g.summary}`,
        canonicalPath: `/discover/games/${g.key}.html`,
        body: gameBody,
      }),
      'utf8'
    );
  }

  const urls = [
    '/',
    '/discover/index.html',
    ...games.map((g) => `/discover/games/${g.key}.html`),
  ];
  const now = new Date().toISOString();
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${siteUrl}${u}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${u === '/' ? '1.0' : '0.7'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;
  await fs.writeFile(sitemapPath, sitemap, 'utf8');

  console.log(`Programmatic SEO pages generated: ${games.length + 1}`);
}

generate().catch((err) => {
  console.error('Failed to generate programmatic SEO assets:', err);
  process.exit(1);
});

