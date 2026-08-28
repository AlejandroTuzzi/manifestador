import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryExists,
  deletePromptCategoryData,
  deleteSnippetCategoryData,
  deleteVocabularyCategoryData,
  isReservedPromptCategory,
  renamePromptCategoryData,
  renameSnippetCategoryData,
  renameVocabularyCategoryData
} from '../lib/categories.js';

describe('administración de categorías', () => {
  test('renombra una categoría de prompts en todos los modos y sus elementos', () => {
    const result = renamePromptCategoryData(
      { image: ['Retratos', 'Producto'], video: ['retratos'] },
      [{ id: 'a', category: 'Retratos' }, { id: 'b', category: 'Otra' }],
      'RETRATOS',
      'Personajes'
    );

    assert.deepEqual(result.promptCategories, { image: ['Personajes', 'Producto'], video: ['Personajes'] });
    assert.equal(result.prompts[0].category, 'Personajes');
    assert.equal(result.prompts[1].category, 'Otra');
    assert.equal(result.affected, 1);
  });

  test('borrar una categoría de prompts conserva sus prompts en General', () => {
    const result = deletePromptCategoryData(
      { image: ['Archivo', 'Producto'] },
      [{ id: 'a', category: 'Archivo' }],
      'Archivo'
    );

    assert.deepEqual(result.promptCategories, { image: ['Producto'] });
    assert.equal(result.prompts[0].category, 'General');
    assert.equal(result.affected, 1);
  });

  test('renombra y elimina categorías de snippets sin borrar snippets', () => {
    const renamed = renameSnippetCategoryData(
      ['After Effects', 'Utilidades'],
      [{ id: 'a', category: 'after effects' }],
      'After Effects',
      'Adobe'
    );
    assert.deepEqual(renamed.snippetCategories, ['Adobe', 'Utilidades']);
    assert.equal(renamed.snippets[0].category, 'Adobe');

    const deleted = deleteSnippetCategoryData(renamed.snippetCategories, renamed.snippets, 'Adobe');
    assert.deepEqual(deleted.snippetCategories, ['Utilidades']);
    assert.equal(deleted.snippets[0].category, '');
  });

  test('detecta colisiones y categorías reservadas sin distinguir mayúsculas', () => {
    assert.equal(categoryExists({ image: ['Retratos'] }, [], 'retratos'), true);
    assert.equal(categoryExists([], [{ category: 'Código' }], 'CÓDIGO'), true);
    assert.equal(isReservedPromptCategory(' estilos '), true);
    assert.equal(isReservedPromptCategory('Personal'), false);
  });
  test('renombra y elimina categorías de vocabulario conservando las fichas', () => {
    const renamed = renameVocabularyCategoryData(
      ['Prendas', 'Arquitectura'],
      [{ id: 'a', category: 'prendas' }],
      'Prendas',
      'Moda'
    );
    assert.deepEqual(renamed.vocabularyCategories, ['Moda', 'Arquitectura']);
    assert.equal(renamed.vocabulary[0].category, 'Moda');

    const deleted = deleteVocabularyCategoryData(renamed.vocabularyCategories, renamed.vocabulary, 'Moda');
    assert.deepEqual(deleted.vocabularyCategories, ['Arquitectura']);
    assert.equal(deleted.vocabulary[0].category, 'General');
  });
});
