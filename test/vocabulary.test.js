import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVocabularyImageKey,
  normalizeVocabularyWords,
  parseVocabularyAnalysis,
  sanitizeVocabularyEntry
} from '../lib/vocabulary.js';

describe('vocabulario', () => {
  test('convierte texto separado por comas o líneas en etiquetas únicas', () => {
    assert.deepEqual(
      normalizeVocabularyWords('crop-top, t-shirt\nCrop-Top; tank top'),
      ['crop-top', 't-shirt', 'tank top']
    );
  });

  test('acepta sólo imágenes locales seguras de Assets', () => {
    assert.equal(normalizeVocabularyImageKey('uploads/2026-camisetas.png'), 'uploads/2026-camisetas.png');
    assert.equal(normalizeVocabularyImageKey('video/referencia.mp4'), '');
    assert.equal(normalizeVocabularyImageKey('uploads/../config.json'), '');
  });

  test('conserva identidad y fecha original al editar', () => {
    const previous = {
      id: 'v1', title: 'Camisetas', category: 'Ropa', imageKey: 'uploads/a.png',
      words: ['t-shirt'], nsfw: false, ts: 100
    };
    assert.deepEqual(sanitizeVocabularyEntry({ words: ['crop-top'], nsfw: true }, previous, { now: 200 }), {
      id: 'v1', title: 'Camisetas', category: 'Ropa', imageKey: 'uploads/a.png',
      words: ['crop-top'], nsfw: true, ts: 100, updatedAt: 200
    });
  });
  test('separa el título del documento de las etiquetas detectadas', () => {
    assert.deepEqual(parseVocabularyAnalysis(`\`\`\`json
      {"documentTitle":"The ultimate fashion vocabulary","terms":["_triangle","bullet","Triangle"]}
    \`\`\``), {
      documentTitle: 'The ultimate fashion vocabulary',
      terms: ['triangle', 'bullet']
    });
  });
});
