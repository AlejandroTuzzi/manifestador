export function normalizeVocabularyWords(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
  const seen = new Set();
  return source
    .map((word) => String(word || '').trim().replace(/\s+/g, ' ')
      .replace(/^[\s_•·—–-]+|[\s_•·—–-]+$/g, '').slice(0, 120))
    .filter((word) => {
      const key = word.toLocaleLowerCase('es');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

export function parseVocabularyAnalysis(value) {
  const text = String(value || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('La IA no devolvió un resultado estructurado.');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('La IA devolvió un JSON de vocabulario inválido.');
  }
  return {
    documentTitle: String(parsed.documentTitle || parsed.title || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    terms: normalizeVocabularyWords(parsed.terms || parsed.words || [])
  };
}

export function normalizeVocabularyImageKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 500 || key.includes('..') || key.includes('\\') || /[\x00-\x1f]/.test(key)) return '';
  return /^(generated|uploads)\/[\w./ -]+$/i.test(key) ? key : '';
}

export function sanitizeVocabularyEntry(body = {}, previous = {}, options = {}) {
  const now = Number(options.now) || Date.now();
  return {
    id: previous.id || String(options.id || ''),
    title: String(body.title ?? previous.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    category: String(body.category ?? previous.category ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    imageKey: normalizeVocabularyImageKey(body.imageKey ?? previous.imageKey),
    words: normalizeVocabularyWords(body.words ?? previous.words),
    nsfw: body.nsfw !== undefined ? Boolean(body.nsfw) : Boolean(previous.nsfw),
    ts: Number(previous.ts) || now,
    updatedAt: now
  };
}
