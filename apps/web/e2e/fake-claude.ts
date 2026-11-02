import http from 'node:http';

/**
 * Testserver mit der Schnittstelle der Claude-API (POST /v1/messages) für den Foto-Assistenten.
 * Antwortet immer mit demselben Vorschlag (Grafikkarte). Die API muss mit ANTHROPIC_BASE_URL=http://127.0.0.1:<port>,
 * AI_ENABLED=true und einem beliebigen ANTHROPIC_API_KEY gestartet sein.
 */
export const FAKE_SUGGESTION = {
  recognized: true,
  categoryPath: 'marktplatz/computer-software/pc-komponenten/grafikkarten',
  title: 'ASUS Dual GeForce RTX 4070 Super 12 GB',
  description: 'Grafikkarte ASUS Dual GeForce RTX 4070 Super mit 12 GB GDDR6X Grafikspeicher. Originalverpackung, mit Zubehör.',
  condition: 'LIKE_NEW',
  attributes: [
    { key: 'chipMaker', value: 'nvidia' },
    { key: 'chipModel', value: 'GeForce RTX 4070 Super' },
    { key: 'vramGb', value: '12' },
    { key: 'brand', value: 'ASUS' },
  ],
};

export async function startFakeClaude(port: number) {
  const stats = { requests: 0 };
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) return void res.writeHead(404).end();
    req.resume();
    req.on('end', () => {
      stats.requests++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_e2e',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify(FAKE_SUGGESTION) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1800, output_tokens: 150 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { stats, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
