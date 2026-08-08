// Puente hacia una instancia de ComfyUI externa, vía los nodos custom del
// paquete "comfyui-tuzziAI". Manifestador no elige workflows: recibe la ruta
// a UN workflow (formato API) que el usuario arma y mantiene en ComfyUI,
// busca ahí los nodos Tuzzi que reconoce y llena los que encuentra.

import { readFile } from 'node:fs/promises';

const HISTORY_TIMEOUT_MS = 20 * 60 * 1000; // grafos de video pueden tardar
const HISTORY_POLL_MS = 1500;
const HEALTH_TIMEOUT_MS = 8000;

export const TUZZI_TYPES = {
  prompt: 'TuzziPromptText',
  reference: 'TuzziReferenceImage',
  poseControlNet: 'TuzziPoseControlNet',
  poseIpAdapter: 'TuzziPoseIPAdapter',
  resolution: 'TuzziResolution',
  outputImage: 'TuzziOutputImage',
  outputVideo: 'TuzziOutputVideo',
  outputAudio: 'TuzziOutputAudio',
  customValues: 'TuzziCustomValues'
};

function comfyBase(cfg) {
  const host = cfg?.comfyui?.host || '127.0.0.1';
  const port = cfg?.comfyui?.port || 8188;
  return `http://${host}:${port}`;
}

function comfyWsUrl(cfg, clientId) {
  const host = cfg?.comfyui?.host || '127.0.0.1';
  const port = cfg?.comfyui?.port || 8188;
  return `ws://${host}:${port}/ws?clientId=${encodeURIComponent(clientId)}`;
}

export async function loadWorkflow(workflowPath) {
  const trimmed = String(workflowPath || '').trim();
  if (!trimmed) throw new Error('Configurá la ruta del workflow de ComfyUI en Configuración → ComfyUI.');
  let raw;
  try {
    raw = await readFile(trimmed, 'utf8');
  } catch {
    throw new Error(`No encuentro el workflow "${trimmed}". Exportalo desde ComfyUI con "Save (API Format)".`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`El workflow "${trimmed}" no es un JSON válido. Reexportalo desde ComfyUI con "Save (API Format)".`);
  }
}

// Agrupa node-ids por class_type: { TuzziPromptText: ['12'], TuzziOutputVideo: ['31'], ... }
export function scanWorkflowSlots(graph) {
  const slots = {};
  for (const [nodeId, node] of Object.entries(graph || {})) {
    const type = node?.class_type;
    if (!type) continue;
    if (!slots[type]) slots[type] = [];
    slots[type].push(nodeId);
  }
  return slots;
}

// Traduce proporción + nivel de resolución a un tamaño en px, redondeado a
// múltiplos de 64 (cómodo para checkpoints SDXL/Flux). Mismo criterio de
// áreas objetivo que gptImageSize (lib/providers.js), pero sin su tope de
// borde/relación de aspecto — acá el usuario controla el modelo real.
export function comfyResolutionPixels(aspectRatio, resolution) {
  const [a, b] = (aspectRatio && aspectRatio !== 'auto' ? aspectRatio : '1:1').split(':').map(Number);
  const ratioA = Number.isFinite(a) && a > 0 ? a : 1;
  const ratioB = Number.isFinite(b) && b > 0 ? b : 1;
  const targetArea = resolution === '4K' ? 8294400 : resolution === '2K' ? 4194304 : 1048576;
  const snap = (v) => Math.max(64, Math.round(v / 64) * 64);
  const w = snap(Math.sqrt((targetArea * ratioA) / ratioB));
  const h = snap((w * ratioB) / ratioA);
  return [w, h];
}

// Clona el grafo y sobreescribe los widgets de los nodos Tuzzi encontrados.
// Si un tipo de slot no está en el grafo, no hace nada. Si el usuario no
// mandó valor para un slot presente (ref/pose sin elegir), se deja el widget
// tal cual venía en el JSON exportado — si el nodo lo necesita, falla solo.
export function fillSlots(graph, slots, values) {
  const next = JSON.parse(JSON.stringify(graph));
  const setInput = (type, key, value) => {
    if (value === undefined || value === null) return;
    for (const nodeId of slots[type] || []) {
      if (!next[nodeId].inputs) next[nodeId].inputs = {};
      next[nodeId].inputs[key] = value;
    }
  };
  setInput(TUZZI_TYPES.prompt, 'text', values.prompt);
  setInput(TUZZI_TYPES.reference, 'url', values.reference);
  setInput(TUZZI_TYPES.poseControlNet, 'url', values.poseControlNet);
  setInput(TUZZI_TYPES.poseIpAdapter, 'url', values.poseIpAdapter);
  setInput(TUZZI_TYPES.resolution, 'width', values.width);
  setInput(TUZZI_TYPES.resolution, 'height', values.height);
  if (Array.isArray(values.customValues)) {
    values.customValues.forEach((v, i) => setInput(TUZZI_TYPES.customValues, `val${i + 1}`, v));
  }
  return next;
}

export async function submitPrompt(cfg, graph, clientId) {
  let res;
  try {
    res = await fetch(`${comfyBase(cfg)}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId })
    });
  } catch (err) {
    throw new Error(`No pude conectar con ComfyUI en ${comfyBase(cfg)}: ${err.message}`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const detail = json?.error?.message || json?.error || text.slice(0, 600);
    throw new Error(`ComfyUI rechazó el workflow (HTTP ${res.status}): ${detail}`);
  }
  if (json?.node_errors && Object.keys(json.node_errors).length) {
    throw new Error(`ComfyUI encontró errores en el workflow: ${JSON.stringify(json.node_errors).slice(0, 600)}`);
  }
  if (!json?.prompt_id) throw new Error('ComfyUI no devolvió un prompt_id.');
  return json.prompt_id;
}

// Progreso en vivo por WebSocket (Node >=22). No fatal si falla: se sigue
// solo con el polling de /history. Devuelve una función para cerrar el socket.
export function watchProgress(cfg, clientId, promptId, onProgress) {
  if (typeof WebSocket === 'undefined' || typeof onProgress !== 'function') return () => {};
  let ws;
  try {
    ws = new WebSocket(comfyWsUrl(cfg, clientId));
  } catch {
    return () => {};
  }
  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type !== 'progress_state' || msg.data?.prompt_id !== promptId) return;
    const nodes = msg.data.nodes || {};
    const active = Object.values(nodes).find((n) => n && typeof n.value === 'number' && typeof n.max === 'number' && n.max > 0);
    if (active) onProgress({ current: active.value, total: active.max });
  });
  ws.addEventListener('error', () => {});
  return () => { try { ws.close(); } catch {} };
}

export async function waitForHistory(cfg, promptId, { timeoutMs = HISTORY_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let res;
    try {
      res = await fetch(`${comfyBase(cfg)}/history/${encodeURIComponent(promptId)}`);
    } catch (err) {
      throw new Error(`Perdí la conexión con ComfyUI mientras esperaba el resultado: ${err.message}`);
    }
    if (res.ok) {
      const json = await res.json();
      const entry = json?.[promptId];
      if (entry) {
        if (entry.status?.status_str === 'error') {
          const detail = (entry.status.messages || []).map((m) => JSON.stringify(m)).join(' | ').slice(0, 600);
          throw new Error(`ComfyUI falló al ejecutar el workflow${detail ? `: ${detail}` : '.'}`);
        }
        return entry;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, HISTORY_POLL_MS));
  }
  throw new Error('ComfyUI no terminó la generación dentro del tiempo de espera.');
}

// Recorre las salidas de cada nodo Tuzzi de output presente y devuelve todas
// las que tengan resultado (no solo la primera).
export function extractOutputs(historyEntry, slots) {
  const outputs = historyEntry?.outputs || {};
  const kinds = [
    { type: TUZZI_TYPES.outputImage, kind: 'image' },
    { type: TUZZI_TYPES.outputVideo, kind: 'video' },
    { type: TUZZI_TYPES.outputAudio, kind: 'audio' }
  ];
  const groups = [];
  for (const { type, kind } of kinds) {
    const files = [];
    for (const nodeId of slots[type] || []) {
      const nodeOutput = outputs[nodeId];
      if (!nodeOutput || typeof nodeOutput !== 'object') continue;
      for (const value of Object.values(nodeOutput)) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (item && typeof item === 'object' && item.filename) files.push(item);
        }
      }
    }
    if (files.length) groups.push({ kind, files });
  }
  return groups;
}

export async function downloadView(cfg, { filename, subfolder, type }) {
  const url = `${comfyBase(cfg)}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder || '')}&type=${encodeURIComponent(type || 'output')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No pude descargar "${filename}" de ComfyUI (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function checkComfyHealth(cfg) {
  let res;
  try {
    res = await fetch(`${comfyBase(cfg)}/system_stats`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`No pude conectar con ComfyUI en ${comfyBase(cfg)}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`ComfyUI respondió HTTP ${res.status}.`);
  return res.json();
}
