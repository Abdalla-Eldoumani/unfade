// The Claude request, checked against a fake API so no key or network is
// needed. It belongs with claude.js: change the two together. `npm run check`
// (scripts/check.mjs) runs it and reports the problems it returns.
export async function checkClaudeRequest() {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  const { analyzeWithClaude } = await import('./claude.js');
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    const reply = {
      titleSuggestion: 'A cat up close', scale: 'closeup', light: 'daylight', particles: 'dust',
      soundLayers: ['room_tone', 'birds', 'wind', 'rain'], lens: 'main',
      anchors: [{ x: 546, y: 300, label: 'the eyes', question: 'What did you call this cat?', sound: 'none' }],
    };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn' }), { status: 200 });
  };
  try {
    const a = await analyzeWithClaude({ base64: 'AAAA', mediaType: 'image/jpeg', width: 1092, height: 600, hints: { title: 'Mochi' } });
    const problems = [];
    if (sent.headers['anthropic-version'] !== '2026-10-21') problems.push('anthropic-version header');
    if (!sent.headers['x-api-key']) problems.push('no key header');
    if (sent.body.output_config?.format?.type !== 'json_schema') problems.push('no json_schema format');
    if (sent.body.output_config?.effort !== (process.env.UNFADE_EFFORT || 'low')) problems.push('effort is not low (or UNFADE_EFFORT)');
    for (const k of ['temperature', 'top_p', 'top_k']) if (k in sent.body) problems.push(`${k} is rejected by this API version`);
    if (Math.abs(a.anchors[0].x - 0.5) > 0.001 || Math.abs(a.anchors[0].y - 0.5) > 0.001) problems.push('anchor not normalised to 0..1');
    if (a.soundLayers.length !== 3) problems.push('sound layers not capped at three');
    return problems;
  } finally {
    globalThis.fetch = realFetch;
  }
}
