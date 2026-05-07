#!/usr/bin/env node
/**
 * Patches @jubbio/voice for correct operation on Linux / Replit / Render.
 *
 * Applied automatically via the "postinstall" npm hook on every `npm install`.
 *
 * Patch A — Dynamic yt-dlp path (AudioPlayer + AudioResource)
 *   Replaces the hardcoded '~/.local/bin/yt-dlp' (or HOME-based) path with a
 *   runtime resolver that checks, in order:
 *     1. process.env.YTDLP_PATH          (user-configured, highest priority)
 *     2. ~/.local/bin/yt-dlp             (Replit default)
 *     3. /usr/local/bin/yt-dlp           (pip install on Ubuntu/Render)
 *     4. /usr/bin/yt-dlp                 (system package)
 *     5. `which yt-dlp`                  (PATH fallback)
 *     6. 'yt-dlp'                        (last resort)
 *
 * Patch B — yt-dlp args (AudioPlayer Unix branch)
 *   Replaces the entire ytdlpArgs array with a single canonical definition:
 *     --js-runtimes node:<path>          nsig JS-challenge extraction
 *     --extractor-args youtube:...       android_vr client → bypasses bot blocks
 *     --cookies <file>                   injected if YOUTUBE_COOKIES_FILE is set
 *     -f bestaudio/best -o - …           original audio-pipe flags
 *
 * Each patch anchors on stable surrounding code so it is fully idempotent —
 * re-running the script on an already-patched file is safe.
 */

const fs   = require('fs');
const path = require('path');

const VOICE_DIR   = path.join(__dirname, '..', 'node_modules', '@jubbio', 'voice', 'dist');
const PLAYER_JS   = path.join(VOICE_DIR, 'AudioPlayer.js');
const RESOURCE_JS = path.join(VOICE_DIR, 'AudioResource.js');

// ── Shared dynamic path resolver ─────────────────────────────────────────────
const PATH_RESOLVER = [
  "(function() {",
  "  const _fs = require('fs');",
  "  const _c = [",
  "    process.env.YTDLP_PATH,",
  "    process.env.HOME + '/.local/bin/yt-dlp',",
  "    '/usr/local/bin/yt-dlp',",
  "    '/usr/bin/yt-dlp',",
  "  ].filter(Boolean);",
  "  for (const _p of _c) { if (_fs.existsSync(_p)) return _p; }",
  "  try { return require('child_process').execSync('which yt-dlp', { encoding: 'utf8' }).trim(); } catch (_e) {}",
  "  return 'yt-dlp';",
  "})()",
].join(' ');

// ── Canonical ytdlpArgs array (replaces the entire array literal) ─────────────
// Anchored between "// Unix: use args array" and "const ffmpegArgs" so it
// matches exactly once regardless of what the array contents currently are.
const ARGS_ANCHOR_START = '                // Unix: use args array (no shell needed)\n                const ytdlpArgs = [';
const ARGS_ANCHOR_END   = '\n                ];\n                const ffmpegArgs';

const ARGS_CANONICAL = [
  '                // Unix: use args array (no shell needed)',
  '                const ytdlpArgs = [',
  "                    '--js-runtimes', 'node:' + process.execPath,",
  "                    '--extractor-args', 'youtube:player_client=android_vr,web',",
  "                    ...(process.env.YOUTUBE_COOKIES_FILE ? ['--cookies', process.env.YOUTUBE_COOKIES_FILE] : []),",
  "                    '-f', 'bestaudio/best',",
  "                    '-o', '-',",
  "                    '--no-playlist',",
  "                    '--no-warnings',",
  "                    '--default-search', 'ytsearch',",
  '                    inputSource',
  '                ];',
  '                const ffmpegArgs',
].join('\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFile(file) {
  if (!fs.existsSync(file)) {
    console.error(`[patch] File not found: ${file}`);
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

function applyStringPatch(src, bad, good, label, basename) {
  if (!src.includes(bad)) {
    console.log(`[patch] Skip   "${label}" — pattern not found in ${basename}`);
    return { src, changed: false };
  }
  console.log(`[patch] Apply  "${label}" in ${basename}`);
  return { src: src.replaceAll(bad, good), changed: true };
}

/**
 * Replace everything between startAnchor and endAnchor (inclusive) with
 * replacement. If the content between the anchors already equals the
 * canonical replacement, the file is left untouched.
 */
function applyBlockPatch(src, startAnchor, endAnchor, replacement, label, basename) {
  const si = src.indexOf(startAnchor);
  if (si === -1) {
    console.log(`[patch] Skip   "${label}" — start anchor not found in ${basename}`);
    return { src, changed: false };
  }
  const ei = src.indexOf(endAnchor, si + startAnchor.length);
  if (ei === -1) {
    console.log(`[patch] Skip   "${label}" — end anchor not found in ${basename}`);
    return { src, changed: false };
  }

  const fullMatch = src.slice(si, ei + endAnchor.length);
  if (fullMatch === replacement) {
    console.log(`[patch] Skip   "${label}" — already canonical in ${basename}`);
    return { src, changed: false };
  }

  console.log(`[patch] Apply  "${label}" in ${basename}`);
  return { src: src.slice(0, si) + replacement + src.slice(ei + endAnchor.length), changed: true };
}

// ── Patch AudioPlayer.js ──────────────────────────────────────────────────────

let playerSrc = readFile(PLAYER_JS);
if (playerSrc) {
  let changed = false;
  let result;

  // Patch A1: tilde path (fresh install)
  result = applyStringPatch(playerSrc, "'~/.local/bin/yt-dlp'", PATH_RESOLVER, 'A1 path (tilde)', 'AudioPlayer.js');
  if (result.changed) { playerSrc = result.src; changed = true; }

  // Patch A2: HOME-based path (already patched but not yet dynamic)
  result = applyStringPatch(playerSrc, "(process.env.HOME + '/.local/bin/yt-dlp')", PATH_RESOLVER, 'A2 path (HOME→dyn)', 'AudioPlayer.js');
  if (result.changed) { playerSrc = result.src; changed = true; }

  // Patch B: canonical ytdlpArgs array (idempotent block replace)
  result = applyBlockPatch(
    playerSrc,
    ARGS_ANCHOR_START,
    ARGS_ANCHOR_END,
    ARGS_CANONICAL,
    'B  ytdlpArgs (canonical)',
    'AudioPlayer.js',
  );
  if (result.changed) { playerSrc = result.src; changed = true; }

  if (changed) fs.writeFileSync(PLAYER_JS, playerSrc, 'utf8');
}

// ── Patch AudioResource.js ────────────────────────────────────────────────────

let resourceSrc = readFile(RESOURCE_JS);
if (resourceSrc) {
  let changed = false;
  let result;

  // Patch A1: tilde path (fresh install)
  result = applyStringPatch(resourceSrc, "'~/.local/bin/yt-dlp'", PATH_RESOLVER, 'A1 path (tilde)', 'AudioResource.js');
  if (result.changed) { resourceSrc = result.src; changed = true; }

  // Patch A2: HOME-based path
  result = applyStringPatch(resourceSrc, "(process.env.HOME + '/.local/bin/yt-dlp')", PATH_RESOLVER, 'A2 path (HOME→dyn)', 'AudioResource.js');
  if (result.changed) { resourceSrc = result.src; changed = true; }

  if (changed) fs.writeFileSync(RESOURCE_JS, resourceSrc, 'utf8');
}

console.log('[patch] Done.');
