import prisma from '../db.js';

export async function generateMatchHyperframeHtml(matchId: string): Promise<string> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      participants: {
        include: { agent: true }
      },
      rounds: {
        include: {
          actions: {
            include: { agent: true }
          }
        },
        orderBy: { roundNumber: 'asc' }
      },
      logs: {
        orderBy: { createdAt: 'asc' }
      }
    }
  });

  if (!match) {
    throw new Error(`Match with ID ${matchId} not found.`);
  }

  const durationPerRound = 4; // seconds
  const introDuration = 3; // seconds
  const outroDuration = 4; // seconds
  const roundsCount = match.rounds.length;
  
  const totalDuration = introDuration + (roundsCount * durationPerRound) + outroDuration;

  // Header template with Google Fonts (Outfit) and beautiful glassmorphic dark theme
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Conclave Match Replay #${match.id.substring(0, 8)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(circle at center, #0f172a, #020617);
      color: #f8fafc;
      width: 1280px;
      height: 720px;
      overflow: hidden;
      position: relative;
    }
    
    /* HyperFrames Stage rules */
    .slide {
      position: absolute;
      top: 0;
      left: 0;
      width: 1280px;
      height: 720px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      opacity: 0;
      transition: opacity 0.5s ease-in-out;
      padding: 40px;
    }

    /* Active styling is handled by hyperframes framework via data-start and data-duration attributes,
       but for raw preview we can show them using a custom engine or standard animation. */
    .slide[data-active="true"] {
      opacity: 1;
      z-index: 10;
    }

    /* Glass Card */
    .glass-card {
      background: rgba(30, 41, 59, 0.7);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 40px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      width: 100%;
      max-width: 900px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .badge {
      background: linear-gradient(135deg, #6d5efc, #14d6a3);
      color: #0b1020;
      font-weight: 800;
      padding: 6px 16px;
      border-radius: 9999px;
      text-transform: uppercase;
      font-size: 0.85rem;
      margin-bottom: 20px;
      letter-spacing: 1.5px;
    }

    h1 {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(to right, #f8fafc, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }

    h2 {
      font-size: 2.2rem;
      font-weight: 800;
      color: #14d6a3;
      margin-bottom: 20px;
    }

    .subtitle {
      color: #94a3b8;
      font-size: 1.2rem;
      margin-bottom: 40px;
    }

    .vs-container {
      display: flex;
      justify-content: space-around;
      align-items: center;
      width: 100%;
      margin: 20px 0;
    }

    .player-card {
      flex: 1;
      padding: 20px;
    }

    .player-name {
      font-size: 1.8rem;
      font-weight: 600;
      color: #f8fafc;
    }

    .player-owner {
      font-size: 1rem;
      color: #64748b;
    }

    .versus {
      font-size: 2rem;
      font-weight: 800;
      color: #6d5efc;
      padding: 0 20px;
    }

    /* Actions and Boards */
    .round-actions {
      display: flex;
      justify-content: space-around;
      width: 100%;
      margin-top: 30px;
      gap: 20px;
    }

    .action-bubble {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 20px;
      flex: 1;
      text-align: left;
    }

    .action-label {
      font-size: 0.9rem;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 5px;
    }

    .action-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: #14d6a3;
    }

    /* Tic Tac Toe Grid rendering if applicable */
    .ttt-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      width: 180px;
      height: 180px;
      margin: 20px auto;
    }
    .ttt-cell {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      font-weight: 800;
      border-radius: 8px;
    }
    .cell-x { color: #6d5efc; }
    .cell-o { color: #14d6a3; }

    /* Results */
    .score-value {
      font-size: 3.5rem;
      font-weight: 800;
      color: #f8fafc;
    }
    .winner-banner {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, #ffd700, #ff8c00);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 20px;
    }
  </style>
  <!-- Auto-advance script for headless browser or manual preview -->
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const slides = document.querySelectorAll('.slide');
      
      function updateTime(time) {
        slides.forEach(slide => {
          const start = parseFloat(slide.getAttribute('data-start'));
          const duration = parseFloat(slide.getAttribute('data-duration'));
          if (time >= start && time < start + duration) {
            slide.setAttribute('data-active', 'true');
          } else {
            slide.removeAttribute('data-active');
          }
        });
      }

      // If running outside HyperFrames previewer, simulate it
      let currentTime = 0;
      setInterval(() => {
        updateTime(currentTime);
        currentTime += 0.1;
        if (currentTime >= ${totalDuration}) {
          currentTime = 0; // Loop
        }
      }, 100);
    });
  </script>
</head>
<body>
<div data-composition-id="match-video" data-duration="${totalDuration}" style="width: 1280px; height: 720px; position: relative; overflow: hidden;">
`;

  // 1. Intro Slide
  const player1 = match.participants.find(p => p.role === 'player_1') || match.participants[0];
  const player2 = match.participants.find(p => p.role === 'player_2') || match.participants[1];
  
  html += `
  <!-- INTRO SLIDE -->
  <div class="slide" data-start="0" data-duration="${introDuration}">
    <div class="glass-card">
      <div class="badge">Conclave Arena</div>
      <h1>Partida Iniciada</h1>
      <p class="subtitle">Game Type: ${match.gameType.toUpperCase()}</p>
      
      <div class="vs-container">
        <div class="player-card">
          <div class="player-name">${player1 ? player1.agent.name : 'Unknown Agent'}</div>
          <div class="player-owner">Owner: ${player1 ? player1.agent.owner : 'System'}</div>
        </div>
        <div class="versus">VS</div>
        <div class="player-card">
          <div class="player-name">${player2 ? player2.agent.name : 'Unknown Agent'}</div>
          <div class="player-owner">Owner: ${player2 ? player2.agent.owner : 'System'}</div>
        </div>
      </div>
    </div>
  </div>
`;

  // 2. Round Slides
  match.rounds.forEach((round, index) => {
    const start = introDuration + (index * durationPerRound);
    
    // Check if game is Tic Tac Toe and there is a payload board state
    let boardHtml = '';
    if (match.gameType === 'tic_tac_toe' && round.payload) {
      try {
        const board = JSON.parse(round.payload);
        if (Array.isArray(board) && board.length === 9) {
          boardHtml = `<div class="ttt-grid">`;
          board.forEach(cell => {
            const cellClass = cell === 'X' ? 'cell-x' : cell === 'O' ? 'cell-o' : '';
            boardHtml += `<div class="ttt-cell ${cellClass}">${cell || ''}</div>`;
          });
          boardHtml += `</div>`;
        }
      } catch (e) {
        // Not JSON or incorrect format
      }
    }

    // Map actions for players
    const p1Action = round.actions.find(a => a.agentId === (player1 ? player1.agentId : ''));
    const p2Action = round.actions.find(a => a.agentId === (player2 ? player2.agentId : ''));

    html += `
  <!-- ROUND ${round.roundNumber} SLIDE -->
  <div class="slide" data-start="${start}" data-duration="${durationPerRound}">
    <div class="glass-card">
      <div class="badge">Round ${round.roundNumber} of ${roundsCount}</div>
      <h2>Partida em Andamento</h2>
      
      ${boardHtml}

      <div class="round-actions">
        <div class="action-bubble">
          <div class="action-label">${player1 ? player1.agent.name : 'Player 1'}</div>
          <div class="action-value">${p1Action ? p1Action.actionType.toUpperCase() : 'NO ACTION'}</div>
        </div>
        <div class="action-bubble">
          <div class="action-label">${player2 ? player2.agent.name : 'Player 2'}</div>
          <div class="action-value">${p2Action ? p2Action.actionType.toUpperCase() : 'NO ACTION'}</div>
        </div>
      </div>
    </div>
  </div>
`;
  });

  // 3. Outro (Results) Slide
  const startOutro = introDuration + (roundsCount * durationPerRound);
  
  // Determine winner
  let winnerText = 'EMPATE!';
  if (player1 && player2) {
    if (player1.score > player2.score) {
      winnerText = `VITÓRIA DE ${player1.agent.name.toUpperCase()}!`;
    } else if (player2.score > player1.score) {
      winnerText = `VITÓRIA DE ${player2.agent.name.toUpperCase()}!`;
    }
  }

  html += `
  <!-- OUTRO SLIDE -->
  <div class="slide" data-start="${startOutro}" data-duration="${outroDuration}">
    <div class="glass-card">
      <div class="badge">Fim de Jogo</div>
      <div class="winner-banner">${winnerText}</div>
      
      <div class="vs-container">
        <div class="player-card">
          <div class="player-name">${player1 ? player1.agent.name : 'Player 1'}</div>
          <div class="score-value">${player1 ? player1.score : 0}</div>
        </div>
        <div class="versus">:</div>
        <div class="player-card">
          <div class="player-name">${player2 ? player2.agent.name : 'Player 2'}</div>
          <div class="score-value">${player2 ? player2.score : 0}</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>
`;

  return html;
}
