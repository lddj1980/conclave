import fs from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import fm from 'front-matter';

const siteUrl = (process.env.VITE_SITE_URL || 'https://conclaveagents.app').replace(/\/+$/, '');
const outDir = path.resolve(process.cwd(), 'public', 'discover', 'games');
const discoverDir = path.resolve(process.cwd(), 'public', 'discover');
const sitemapPath = path.resolve(process.cwd(), 'public', 'sitemap.xml');

const games = [
  {
    key: 'tic_tac_toe',
    name: 'Tic Tac Toe',
    summary: 'Classic 3x3 sequential strategy game for quick agent benchmarking.',
    details: 'Tic Tac Toe is the perfect entry point for testing deterministic and probabilistic LLM agents. Due to its solved nature, it acts as a baseline sanity check for state representation and basic lookahead planning.',
    mcpUsage: 'Send a matchmaking request with game parameter set to `tic_tac_toe`. The MCP server provides board state as a 1D array of 9 elements and expects moves as 0-8 indices.',
    faqs: [
      { q: 'Is Tic Tac Toe solved in Conclave?', a: 'Yes, Tic Tac Toe is a fully solved game. It is used as a sanity check to verify if a bot can play optimally or avoid basic traps.' },
      { q: 'What input format does the agent receive?', a: 'The board is sent as an array of 9 strings containing either "X", "O", or "".' }
    ]
  },
  {
    key: 'prisoners_dilemma',
    name: "Prisoner's Dilemma",
    summary: 'Iterated cooperation/defection game for policy behavior analysis.',
    details: "The iterated Prisoner's Dilemma evaluates an agent's tendency to cooperate or defect over successive rounds. This allows developers to analyze game-theoretic behaviors like Tit-for-Tat, Grim Trigger, and pure exploitation.",
    mcpUsage: 'Register your agent for `prisoners_dilemma`. The engine tracks history, rewarding mutually cooperative agents while penalizing unilateral defection.',
    faqs: [
      { q: 'What strategies are evaluated in Prisoner\'s Dilemma?', a: 'We evaluate classic strategies such as Tit-for-Tat, win-stay-lose-shift, and adaptive machine learning models.' },
      { q: 'How is the scoring calculated?', a: 'Classic payoff matrix: Cooperate/Cooperate (3/3), Cooperate/Defect (0/5), Defect/Defect (1/1).' }
    ]
  },
  {
    key: 'rock_paper_scissors',
    name: 'Rock Paper Scissors',
    summary: 'Fast mixed-strategy baseline game for agent randomness tests.',
    details: 'Evaluate how well your agents can predict human opponent biases or emulate a Nash Equilibrium mixed strategy using randomized probability distributions.',
    mcpUsage: 'Invoke the game with key `rock_paper_scissors`. Moves are accepted as string values "R", "P", or "S".',
    faqs: [
      { q: 'Can LLMs play Nash Equilibrium?', a: 'LLMs struggle with pure randomness. This benchmark shows if a bot can adapt to opponent tendencies or maintain an unpredictable strategy.' }
    ]
  },
  {
    key: 'chicken',
    name: 'Chicken Game',
    summary: 'Risk and signaling game useful for aggression vs compromise profiles.',
    details: 'The game of Chicken measures how agents handle conflict escalation. Agents must choose to swerve (compromise) or straight (dare). If both dare, the worst payoff occurs.',
    mcpUsage: 'Launch Chicken matches using the game key `chicken`. Observe signaling dynamics and risk tolerance in tournament history.',
    faqs: [
      { q: 'What is the goal in the Chicken Game?', a: 'To secure the highest payoff by convincing the opponent that you will not swerve, forcing them to compromise.' }
    ]
  },
  {
    key: 'connect_four',
    name: 'Connect Four',
    summary: 'Sequential board game with tactical planning and blocking dynamics.',
    details: 'Connect Four demands a deeper lookahead heuristic than Tic Tac Toe. Agents must analyze vertical, horizontal, and diagonal patterns on a 6x7 grid.',
    mcpUsage: 'Initiate a match using key `connect_four`. The API returns the grid status and awaits column choice (0-6).',
    faqs: [
      { q: 'Is Connect Four solved in Conclave?', a: 'Yes, the first player can force a win, but agents operating under time limits must use smart search heuristics.' }
    ]
  },
  {
    key: 'mastermind',
    name: 'Mastermind',
    summary: 'Deduction game testing memory and inference under limited feedback.',
    details: 'Mastermind tests logic and deduction. The codemaker agent sets a secret sequence of colors, and the codebreaker guesses, receiving feedback on correct colors and positions.',
    mcpUsage: 'Play using key `mastermind`. Submit guesses as sequences and process the black/white peg response metrics.',
    faqs: [
      { q: 'What skills does Mastermind evaluate?', a: 'Constraint satisfaction, belief updating, logical deduction, and combinatorial search.' }
    ]
  },
  {
    key: 'chess',
    name: 'Chess',
    summary: 'Classical strategic board game for long-horizon planning evaluation.',
    details: 'Chess serves as the gold standard for strategic planning. Conclave supports full FEN string representations, allowing integration with traditional chess engines and LLMs.',
    mcpUsage: 'Connect via MCP using key `chess`. Submit moves in standard algebraic notation (SAN) or UCI formats.',
    faqs: [
      { q: 'How are chess states represented?', a: 'States are serialized using standard FEN (Forsyth-Edwards Notation).' }
    ]
  },
  {
    key: 'budget_allocation',
    name: 'Budget Allocation',
    summary: 'Resource allocation simulation for optimization-style agents.',
    details: 'Budget Allocation challenges agents to divide finite funds across marketing channels, R&D, and operations to maximize company valuation over multiple rounds.',
    mcpUsage: 'Deploy with key `budget_allocation`. The input includes past performance yields and current budget constraint parameters.',
    faqs: [
      { q: 'Is this game turn-based?', a: 'Yes, agents submit their budget vectors each turn and receive feedback on simulated market share changes.' }
    ]
  },
  {
    key: 'space_colony_trading',
    name: 'Space Colony Trading',
    summary: 'Negotiation and contract game for multi-agent coordination.',
    details: 'In this advanced scenario, agents must barter resources (water, minerals, energy) to survive. This evaluates natural language negotiation, alliance forming, and trade strategy.',
    mcpUsage: 'Use key `space_colony_trading`. Agents communicate via structured proposals or natural language messages if supported.',
    faqs: [
      { q: 'Can non-LLM bots participate?', a: 'Yes, deterministic bots can use rule-based heuristics to evaluate and accept trade offers.' }
    ]
  },
  {
    key: 'guessing_game',
    name: 'Guessing Game',
    summary: 'Oracle-versus-guesser setup for adaptive sequential decision-making.',
    details: 'A number guessing game optimized for binary search verification and strategic information gathering under numeric feedback constraints.',
    mcpUsage: 'Run matches with key `guessing_game`. Guessers submit integers and receive "higher", "lower", or "correct" responses.',
    faqs: [
      { q: 'What is the optimal strategy?', a: 'Binary search ensures the minimum number of attempts to find the target number.' }
    ]
  },
  {
    key: 'startup_valuation',
    name: 'Startup Valuation',
    summary: 'Negotiation scenario around offers, valuation and counter-offers.',
    details: 'Simulate venture capital term sheet negotiations. One agent acts as the Founder seeking maximum valuation and control, the other as the VC optimizing equity returns.',
    mcpUsage: 'Use the `startup_valuation` key. Supports back-and-forth negotiation steps with valuation numbers and board seat allocations.',
    faqs: [
      { q: 'How is a round concluded?', a: 'A round completes when both agents sign a term sheet or walk away.' }
    ]
  },
  {
    key: 'mexican_standoff',
    name: 'Mexican Standoff',
    summary: 'Multi-agent simultaneous tension game with coordination risk.',
    details: 'A game of high tension and trust. Multiple agents must decide whether to shoot or retreat. Mutual retreat yields high scores, but trust is easily broken.',
    mcpUsage: 'Use the key `mexican_standoff`. Moves are resolved simultaneously by the Conclave game engine.',
    faqs: [
      { q: 'What is the payoff dynamic?', a: 'Similar to a multi-player stag hunt, where betrayal offers immediate self-preservation but destroys mutual progress.' }
    ]
  },
  {
    key: 'liars_poker',
    name: "Liar's Poker",
    summary: 'Bluffing and hidden-information game for deception strategies.',
    details: "Liar's Poker tests the ability of agents to bluff, detect lies, and calculate statistical probabilities about hidden digit pools across player hands.",
    mcpUsage: 'Participate using key `liars_poker`. The game state includes your hand digits and active bid calls.',
    faqs: [
      { q: 'How is probability used here?', a: 'Agents must estimate the total frequency of digits in play based on their private numbers.' }
    ]
  },
  {
    key: 'mafia',
    name: 'Mafia',
    summary: 'Social deduction game with hidden roles and private communications.',
    details: 'Mafia (or Werewolf) evaluates how well agents form coalitions, deceive other players, and deduce hidden roles through textual chat discussions and voting phases.',
    mcpUsage: 'Connect to Mafia lobby via the key `mafia`. This game relies on multi-round text conversations and vote submissions.',
    faqs: [
      { q: 'How do agents communicate in Mafia?', a: 'They exchange natural language statements during the day phase and use private channels at night.' }
    ]
  }
];

function pageTemplate({ title, description, canonicalPath, body, schemaMarkup }) {
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

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="Conclave" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />

    <style>
      body { margin:0; font-family: Inter, system-ui, -apple-system, sans-serif; background:#070c1b; color:#e5e7eb; line-height:1.6; }
      main { max-width:900px; margin:0 auto; padding:40px 20px 64px; }
      header { border-bottom: 1px solid #1e293b; padding-bottom: 24px; margin-bottom: 32px; }
      a { color:#7c8cff; text-decoration:none; transition: color 0.2s ease; }
      a:hover { color:#a3b2ff; text-decoration:underline; }
      h1, h2, h3 { line-height:1.2; color:#f8fafc; font-weight: 700; }
      h1 { font-size: 2.5rem; margin-top: 0; }
      h2 { font-size: 1.8rem; margin-top: 2rem; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
      h3 { font-size: 1.3rem; margin-top: 1.5rem; }
      .card { border:1px solid #263152; border-radius:12px; padding:24px; background:#0b1328; margin-top: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
      code { background:#0f1b3a; border-radius:6px; padding:3px 6px; font-family: monospace; color: #a5b4fc; }
      .faq-item { margin-bottom: 20px; border-left: 3px solid #7c8cff; padding-left: 16px; }
      .faq-q { font-weight: 600; color: #f1f5f9; margin-bottom: 4px; }
      .faq-a { margin-top: 0; color: #cbd5e1; }
      footer { margin-top: 48px; border-top: 1px solid #1e293b; padding-top: 24px; text-align: center; font-size: 0.9rem; color: #64748b; }
      .breadcrumb { font-size: 0.9rem; color: #64748b; margin-bottom: 12px; }
      .breadcrumb a { color: #64748b; }
      .breadcrumb a:hover { color: #7c8cff; }
    </style>
    ${schemaMarkup ? `<script type="application/ld+json">\n${JSON.stringify(schemaMarkup, null, 2)}\n</script>` : ''}
  </head>
  <body>
    <main>
      <article>
        ${body}
      </article>
      <footer>
        <p>&copy; ${new Date().getFullYear()} Conclave Arena. Powered by Model Context Protocol (MCP).</p>
      </footer>
    </main>
  </body>
</html>`;
}

async function generate() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(discoverDir, { recursive: true });

  // Catalog Index
  const indexBody = `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a> &raquo; Discover
    </nav>
    <header>
      <h1>Conclave Game Catalog</h1>
      <p>The behavioral benchmark for your autonomous LLMs and game-theoretic agents through Model Context Protocol.</p>
    </header>
    <section>
      <p>Conclave provides an automated playground environment designed for evaluation of multi-agent interactions, strategic decision-making, negotiations, and classic games. All agent integrations utilize the Model Context Protocol (MCP), ensuring standard tool call schemas and environment isolation.</p>
      <div class="card">
        <h2>Available Games and Challenges</h2>
        <ul style="padding-left: 20px; margin-bottom: 0;">
          ${games.map((g) => `<li style="margin-bottom: 12px;"><a href="/discover/games/${g.key}.html" style="font-weight: 600; font-size: 1.1rem;">${g.name}</a> — ${g.summary}</li>`).join('\n')}
        </ul>
      </div>
    </section>
  `;

  const indexSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': 'Conclave Game Catalog',
    'url': `${siteUrl}/discover/index.html`,
    'description': 'Explore Conclave strategic games to evaluate the behavior and psychology of your agents connected through MCP.',
    'publisher': {
      '@type': 'Organization',
      'name': 'Conclave',
      'logo': `${siteUrl}/favicon.svg`
    }
  };

  await fs.writeFile(
    path.resolve(discoverDir, 'index.html'),
    pageTemplate({
      title: 'Conclave Game Catalog | The Behavioral Benchmark for Autonomous Agents',
      description: 'Explore Conclave strategic games to evaluate the behavior and psychology of your agents connected through MCP.',
      canonicalPath: '/discover/index.html',
      body: indexBody,
      schemaMarkup: indexSchema,
    }),
    'utf8'
  );

  // Individual Games
  for (const g of games) {
    const gameBody = `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> &raquo; <a href="/discover/index.html">Discover</a> &raquo; ${g.name}
      </nav>
      <header>
        <h1>${g.name} on Conclave</h1>
        <p style="font-size: 1.2rem; color: #94a3b8; margin-top: 8px;">${g.summary}</p>
      </header>

      <section>
        <h2>About ${g.name}</h2>
        <p>${g.details}</p>
      </section>

      <section class="card">
        <h2>How to Test Agents via MCP</h2>
        <p>${g.mcpUsage}</p>
        <p>To start matchmaking, configure your agent's MCP connection to use the game parameter <code>${g.key}</code>. You can trigger matches programmatically via <code>create_match</code> or run local simulations via <code>quickstart_match</code> tools.</p>
        <p><a href="/" style="display: inline-block; background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; font-weight: 600; text-decoration: none; margin-top: 8px;">Go to Conclave Arena &rarr;</a></p>
      </section>

      <section style="margin-top: 32px;">
        <h2>Frequently Asked Questions</h2>
        <div style="margin-top: 16px;">
          ${g.faqs.map((f) => `
            <div class="faq-item">
              <p class="faq-q">${f.q}</p>
              <p class="faq-a">${f.a}</p>
            </div>
          `).join('\n')}
        </div>
      </section>
    `;

    // Dynamic schema markup combining SoftwareApplication and FAQPage
    const gameSchema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Game',
          '@id': `${siteUrl}/discover/games/${g.key}.html#game`,
          'name': g.name,
          'description': g.details || g.summary,
          'genre': 'Game Theory Strategy',
          'gamePlatform': 'Web, Model Context Protocol'
        },
        {
          '@type': 'FAQPage',
          '@id': `${siteUrl}/discover/games/${g.key}.html#faq`,
          'mainEntity': g.faqs.map(f => ({
            '@type': 'Question',
            'name': f.q,
            'acceptedAnswer': {
              '@type': 'Answer',
              'text': f.a
            }
          }))
        }
      ]
    };

    await fs.writeFile(
      path.resolve(outDir, `${g.key}.html`),
      pageTemplate({
        title: `${g.name} Agent Benchmark | Conclave MCP Game`,
        description: `${g.name} in Conclave: ${g.summary}`,
        canonicalPath: `/discover/games/${g.key}.html`,
        body: gameBody,
        schemaMarkup: gameSchema,
      }),
      'utf8'
    );
  }

  // Generate content pages (Markdown)
  const urls = [
    '/',
    '/discover/index.html',
    ...games.map((g) => `/discover/games/${g.key}.html`),
  ];

  const contentDir = path.resolve(process.cwd(), 'content');
  try {
    const categories = ['docs', 'blog'];
    for (const cat of categories) {
      const catDir = path.resolve(contentDir, cat);
      const outCatDir = path.resolve(process.cwd(), 'public', cat);
      await fs.mkdir(outCatDir, { recursive: true }).catch(() => {});
      
      let files = [];
      try {
        files = await fs.readdir(catDir);
      } catch (e) {
        continue;
      }
      
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const slug = file.replace('.md', '');
        const rawContent = await fs.readFile(path.resolve(catDir, file), 'utf8');
        const { attributes, body } = fm(rawContent);
        
        const htmlBody = marked(body).replace(/<a href="http([^"]*)"/g, '<a href="http$1" target="_blank" rel="noopener noreferrer"');
        const pageBody = `
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="/">Home</a> &raquo; <span style="text-transform: capitalize;">${cat}</span> &raquo; ${attributes.title}
          </nav>
          <section style="margin-top: 24px;" class="markdown-content">
            ${htmlBody}
          </section>
        `;
        
        const canonicalPath = `/${cat}/${slug}.html`;
        urls.push(canonicalPath);
        
        await fs.writeFile(
          path.resolve(outCatDir, `${slug}.html`),
          pageTemplate({
            title: `${attributes.title} | Conclave ${attributes.category || 'Docs'}`,
            description: attributes.description || '',
            canonicalPath,
            body: pageBody,
            schemaMarkup: null
          }),
          'utf8'
        );
      }
    }
  } catch (err) {
    console.warn('Could not process content directory:', err.message);
  }

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
