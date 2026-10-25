// The Claude request, checked against a fake API so no key or network is
// needed. It belongs with claude.js: change the two together. `npm run check`
// (scripts/check.mjs) runs it and reports the problems it returns.
export async function checkClaudeRequest() {
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
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
    if (sent.headers['x-api-key'] !== 'sk-test-not-real') problems.push('the key header is not the key itself');
    if (sent.body.output_config?.format?.type !== 'json_schema') problems.push('no json_schema format');
    if (sent.body.output_config?.effort !== (process.env.UNFADE_EFFORT || 'low')) problems.push('effort is not low (or UNFADE_EFFORT)');
    for (const k of ['temperature', 'top_p', 'top_k']) if (k in sent.body) problems.push(`${k} is rejected by this API version`);
    if (Math.abs(a.anchors[0].x - 0.5) > 0.001 || Math.abs(a.anchors[0].y - 0.5) > 0.001) problems.push('anchor not normalised to 0..1');
    if (a.soundLayers.length !== 3) problems.push('sound layers not capped at three');

    // a paste into a terminal can wrap the key in bracketed-paste markers or leave a
    // carriage return: only the key itself goes out; a value with no key in it is
    // named in plain words and never quoted back
    const tiny = { base64: 'AAAA', mediaType: 'image/jpeg', width: 10, height: 10 };
    for (const pasted of ['sk-test-not-real\n', '\x1b[200~sk-test-not-real\x1b[201~', ' sk-test-not-real\r\n', '~sk-test-not-real~']) {
      process.env.ANTHROPIC_API_KEY = pasted;
      sent = null;
      await analyzeWithClaude(tiny).catch(() => {});
      if (sent?.headers['x-api-key'] !== 'sk-test-not-real') problems.push(`a pasted key was not cleaned: ${JSON.stringify(pasted)}`);
    }
    for (const value of ['SECRET\x1b[201~', 'not a key SECRET']) {
      process.env.ANTHROPIC_API_KEY = value;
      sent = null;
      const err = await analyzeWithClaude(tiny).then(() => null, (e) => e);
      if (sent || !err?.message.includes('not an Anthropic key') || err.message.includes('SECRET')) problems.push(`a value with no key in it: "${err?.message}"`);
    }
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';

    // failures reach the person as the studio's warning, so they must be plain words that never quote the request
    const failure = async (fakeFetch, want, what) => {
      globalThis.fetch = fakeFetch;
      const err = await analyzeWithClaude(tiny).then(() => null, (e) => e);
      if (!err?.message.includes(want) || !err.message.includes('place the spots yourself') || err.message.includes('SECRET')) problems.push(`${what}: "${err?.message}"`);
    };
    await failure(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }), 'did not accept the API key', 'a wrong key');
    await failure(async () => { throw new TypeError('fetch failed'); }, 'could not be reached', 'no network');
    await failure(async () => { throw new TypeError('Headers.append: "sk-fake-SECRET" is an invalid header value.'); }, 'could not be reached', 'an error that quotes the request');
    return problems;
  } finally {
    globalThis.fetch = realFetch;
  }
}
