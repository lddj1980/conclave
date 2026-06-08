import { generateMatchHyperframeHtml } from '../src/engine/video-renderer.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execAsync = promisify(exec);

async function main() {
  const args = process.argv.slice(2);
  const matchIdArg = args.find(arg => arg.startsWith('--matchId='));
  
  if (!matchIdArg) {
    console.error('Error: Please provide a matchId. Example: --matchId=abcd-1234');
    process.exit(1);
  }
  
  const matchId = matchIdArg.split('=')[1];
  console.log(`[HyperFrames Render] Fetching match details for ID: ${matchId}...`);
  
  try {
    // Generate the HyperFrame HTML
    const htmlContent = await generateMatchHyperframeHtml(matchId);
    
    // Create output directories if they don't exist
    const outputDir = path.resolve('output');
    const videosDir = path.resolve('output/videos');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(videosDir, { recursive: true });
    
    const tempProjDir = path.join(outputDir, `temp_render_${matchId}`);
    await fs.mkdir(tempProjDir, { recursive: true });
    
    const tempHtmlPath = path.join(tempProjDir, 'index.html');
    const outputVideoPath = path.join(videosDir, `match_${matchId.substring(0, 8)}.mp4`);
    
    // Write temporary HTML file
    await fs.writeFile(tempHtmlPath, htmlContent, 'utf-8');
    console.log(`[HyperFrames Render] Temporary HTML project created at: ${tempProjDir}`);
    
    console.log(`[HyperFrames Render] Running 'npx hyperframes render' to compile video...`);
    
    // Execute npx hyperframes render
    const renderCommand = `npx -y hyperframes render "${tempProjDir}" -o "${outputVideoPath}"`;
    console.log(`[HyperFrames Render] Executing command: ${renderCommand}`);
    
    const { stdout, stderr } = await execAsync(renderCommand);
    if (stdout) console.log(`[HyperFrames Render CLI]: ${stdout}`);
    if (stderr) console.warn(`[HyperFrames Render CLI Warning]: ${stderr}`);
    
    console.log(`[HyperFrames Render] Success! Video successfully rendered to: ${outputVideoPath}`);
    
    // Clean up temporary HTML directory
    await fs.rm(tempProjDir, { recursive: true, force: true });
    console.log(`[HyperFrames Render] Cleaned up temporary directory.`);
    
  } catch (error: any) {
    console.error('[HyperFrames Render Error]: Failed to render match video.');
    console.error(error.message || error);
    process.exit(1);
  }
}

main();
