// Tests de las funciones puras de lib/comfyBridge.js — el contrato entre
// Manifestador y los nodos Python de comfyui-tuzziAI (nombres de class_type,
// forma de customValues, resolución en px) se rompe en silencio si alguien
// toca esta lógica sin darse cuenta. Correr con: npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanWorkflowSlots, comfyResolutionPixels, fillSlots, extractOutputs, TUZZI_TYPES } from '../lib/comfyBridge.js';

describe('scanWorkflowSlots', () => {
  test('agrupa node-ids por class_type', () => {
    const graph = {
      '1': { class_type: 'TuzziPromptText', inputs: {} },
      '2': { class_type: 'TuzziOutputImage', inputs: {} },
      '3': { class_type: 'TuzziOutputImage', inputs: {} },
      '4': { class_type: 'KSampler', inputs: {} }
    };
    const slots = scanWorkflowSlots(graph);
    assert.deepEqual(slots.TuzziPromptText, ['1']);
    assert.deepEqual(slots.TuzziOutputImage, ['2', '3']);
    assert.deepEqual(slots.KSampler, ['4']);
  });

  test('ignora nodos sin class_type y grafos vacíos', () => {
    assert.deepEqual(scanWorkflowSlots({ '1': { inputs: {} } }), {});
    assert.deepEqual(scanWorkflowSlots({}), {});
    assert.deepEqual(scanWorkflowSlots(null), {});
    assert.deepEqual(scanWorkflowSlots(undefined), {});
  });
});

describe('comfyResolutionPixels', () => {
  test('1:1 a 1K da 1024x1024 (caso exacto, sin redondeo)', () => {
    assert.deepEqual(comfyResolutionPixels('1:1', '1K'), [1024, 1024]);
  });

  test('el resultado siempre es múltiplo de 64 y respeta la proporción pedida', () => {
    for (const [ar, res] of [['16:9', '1K'], ['9:16', '2K'], ['4:3', '4K'], ['21:9', '1K']]) {
      const [w, h] = comfyResolutionPixels(ar, res);
      assert.equal(w % 64, 0, `ancho no múltiplo de 64 para ${ar}/${res}`);
      assert.equal(h % 64, 0, `alto no múltiplo de 64 para ${ar}/${res}`);
      const [a, b] = ar.split(':').map(Number);
      // tolerancia generosa: a proporciones extremas (21:9) el redondeo a
      // múltiplos de 64 distorsiona más la relación exacta
      assert.ok(Math.abs(w / h - a / b) < 0.1, `proporción ${w}x${h} se aleja demasiado de ${ar}`);
    }
  });

  test('a mayor resolución, mayor área (1K < 2K < 4K)', () => {
    const area = (ar, res) => comfyResolutionPixels(ar, res).reduce((a, b) => a * b);
    assert.ok(area('16:9', '1K') < area('16:9', '2K'));
    assert.ok(area('16:9', '2K') < area('16:9', '4K'));
  });

  test('proporción "auto" o inválida cae a 1:1', () => {
    assert.deepEqual(comfyResolutionPixels('auto', '1K'), [1024, 1024]);
    assert.deepEqual(comfyResolutionPixels('no-es-una-proporcion', '1K'), [1024, 1024]);
  });
});

describe('fillSlots', () => {
  const baseGraph = () => ({
    '1': { class_type: 'TuzziPromptText', inputs: { text: 'placeholder' } },
    '2': { class_type: 'TuzziReferenceImage', inputs: { url: '' } },
    '3': { class_type: 'TuzziResolution', inputs: { width: 512, height: 512 } },
    '4': { class_type: 'TuzziCustomValues', inputs: { val1: 0, val2: 0, val3: 0, val4: 0, val5: 0 } },
    '5': { class_type: 'KSampler', inputs: {} }
  });

  test('llena los widgets de los nodos Tuzzi encontrados', () => {
    const graph = baseGraph();
    const slots = scanWorkflowSlots(graph);
    const filled = fillSlots(graph, slots, { prompt: 'un gato', reference: 'http://x/y.png', width: 1024, height: 768 });
    assert.equal(filled['1'].inputs.text, 'un gato');
    assert.equal(filled['2'].inputs.url, 'http://x/y.png');
    assert.equal(filled['3'].inputs.width, 1024);
    assert.equal(filled['3'].inputs.height, 768);
  });

  test('no muta el grafo original (clona antes de escribir)', () => {
    const graph = baseGraph();
    const slots = scanWorkflowSlots(graph);
    fillSlots(graph, slots, { prompt: 'otro prompt' });
    assert.equal(graph['1'].inputs.text, 'placeholder');
  });

  test('un valor undefined no toca el widget existente', () => {
    const graph = baseGraph();
    const slots = scanWorkflowSlots(graph);
    const filled = fillSlots(graph, slots, { prompt: undefined });
    assert.equal(filled['1'].inputs.text, 'placeholder');
  });

  test('si el tipo de slot no está en el grafo, no rompe nada', () => {
    const graph = { '1': { class_type: 'KSampler', inputs: {} } };
    const slots = scanWorkflowSlots(graph);
    assert.doesNotThrow(() => fillSlots(graph, slots, { prompt: 'x', reference: 'y' }));
  });

  test('customValues llena val1..val5 en TuzziCustomValues por índice', () => {
    const graph = baseGraph();
    const slots = scanWorkflowSlots(graph);
    const filled = fillSlots(graph, slots, { customValues: [1.5, undefined, 3, undefined, 5] });
    assert.equal(filled['4'].inputs.val1, 1.5);
    assert.equal(filled['4'].inputs.val2, 0); // no vino valor -> queda el widget original
    assert.equal(filled['4'].inputs.val3, 3);
    assert.equal(filled['4'].inputs.val5, 5);
  });
});

describe('extractOutputs', () => {
  const slots = {
    [TUZZI_TYPES.outputImage]: ['10'],
    [TUZZI_TYPES.outputVideo]: ['11']
  };

  test('agrupa archivos por tipo de nodo de salida', () => {
    const historyEntry = {
      outputs: {
        10: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
        11: { videos: [{ filename: 'b.mp4', subfolder: '', type: 'output' }] }
      }
    };
    const groups = extractOutputs(historyEntry, slots);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.find((g) => g.kind === 'image').files.map((f) => f.filename), ['a.png']);
    assert.deepEqual(groups.find((g) => g.kind === 'video').files.map((f) => f.filename), ['b.mp4']);
  });

  test('sin outputs para los nodos Tuzzi, devuelve lista vacía', () => {
    assert.deepEqual(extractOutputs({ outputs: {} }, slots), []);
    assert.deepEqual(extractOutputs(null, slots), []);
  });

  test('ignora entradas sin filename o que no son arrays', () => {
    const historyEntry = { outputs: { 10: { images: [{ noFilename: true }], other: 'texto' } } };
    assert.deepEqual(extractOutputs(historyEntry, slots), []);
  });
});
