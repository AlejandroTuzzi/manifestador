// Motor local de generación de imagen — stable-diffusion.cpp (leejet), un
// binario externo sin Python que corre en la máquina del usuario. Se maneja
// igual que ffmpeg: ruta configurable, se invoca por spawn() con args en
// array. Todas las funciones de imagen devuelven [{ buffer, mime }], igual
// que providers.js, para no tocar el resto del pipeline de generación.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Acepta tanto la ruta completa al ejecutable como su carpeta, igual que
// resolveFfmpegExecutable en server.js.
export async function resolveSdCliExecutable(configuredPath) {
  const configured = String(configuredPath || '').trim().replace(/^"(.*)"$/, '$1');
  if (!configured) throw new Error('Configurá la ruta de sd-cli en Configuración → Motores locales.');
  const stat = await fs.stat(configured).catch(() => null);
  const candidates = stat?.isDirectory()
    ? [path.join(configured, 'sd-cli.exe'), path.join(configured, 'sd-cli'), path.join(configured, 'sd.exe'), path.join(configured, 'sd')]
    : [configured];
  for (const candidate of candidates) {
    const candidateStat = await fs.stat(candidate).catch(() => null);
    if (candidateStat?.isFile()) return candidate;
  }
  throw new Error(`No encuentro sd-cli en "${configured}". Elegí la carpeta o el ejecutable.`);
}

// Buckets de tamaño en píxeles por proporción, alineados a 64px (múltiplo
// esperado por SDXL y derivados), apuntando a ~1MP de área total.
const SIZE_BUCKETS = {
  '1:1': [1024, 1024],
  '2:3': [832, 1216],
  '3:2': [1216, 832],
  '3:4': [896, 1152],
  '4:3': [1152, 896],
  '4:5': [896, 1088],
  '5:4': [1088, 896],
  '9:16': [768, 1344],
  '16:9': [1344, 768],
  '21:9': [1536, 640]
};

export function sdcppSize(aspectRatio) {
  return SIZE_BUCKETS[aspectRatio] || SIZE_BUCKETS['1:1'];
}

// onLog (opcional) recibe el comando exacto y la salida del binario, para
// poder mostrarlos en la consola de depuración de Manifestador.
function quoteArg(a) {
  return /\s/.test(a) ? `"${a}"` : a;
}

// sd-cli imprime el progreso del muestreo como "N/M" (con una barra al lado,
// redibujada con \r) — no está 100% confirmado el formato exacto de tu build,
// así que se toma la última coincidencia de cada tanda de salida y se ignoran
// números que no parezcan una cuenta de steps real (tope 500).
const PROGRESS_RE = /(\d{1,3})\s*\/\s*(\d{1,3})/g;
function parseProgress(text, onProgress) {
  if (!onProgress) return;
  const matches = [...text.matchAll(PROGRESS_RE)];
  if (!matches.length) return;
  const [, curStr, totStr] = matches[matches.length - 1];
  const current = Number(curStr), total = Number(totStr);
  if (total > 0 && total <= 500 && current >= 0 && current <= total) onProgress(current, total);
}

function runSdCli(bin, args, { onLog, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    onLog?.(`comando: ${quoteArg(bin)} ${args.map(quoteArg).join(' ')}`);
    const ps = spawn(bin, args, { windowsHide: true });
    let log = '';
    const onData = (d) => {
      const text = d.toString();
      log += text;
      parseProgress(text, onProgress);
    };
    ps.stderr.on('data', onData);
    ps.stdout.on('data', onData);
    ps.on('error', (e) => {
      onLog?.(`no se pudo ejecutar: ${e.message}`);
      reject(new Error(`No se pudo ejecutar sd-cli: ${e.message}`));
    });
    ps.on('close', (code) => {
      onLog?.(`terminó con código ${code}${log ? `\n${log.slice(-4000)}` : ''}`);
      code === 0 ? resolve(log) : reject(new Error(`sd-cli falló (código ${code}): ${log.slice(-800)}`));
    });
  });
}

// modelFiles: { checkpoint?, diffusionModel?, vae?, textEncoder?, visionProjector? }
export async function generateSdCpp({ sdCliPath, modelFiles, prompt, refPath, aspectRatio, extraArgs = [], onLog, onProgress }) {
  const bin = await resolveSdCliExecutable(sdCliPath);
  const [W, H] = sdcppSize(aspectRatio);
  const outPath = path.join(os.tmpdir(), `manifestador-sd-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);

  const args = [];
  if (modelFiles.checkpoint) args.push('-m', modelFiles.checkpoint);
  if (modelFiles.diffusionModel) args.push('--diffusion-model', modelFiles.diffusionModel);
  if (modelFiles.vae) args.push('--vae', modelFiles.vae);
  if (modelFiles.textEncoder) args.push('--llm', modelFiles.textEncoder);
  if (modelFiles.visionProjector) args.push('--llm_vision', modelFiles.visionProjector);
  if (refPath) args.push('-r', refPath);
  args.push('-p', prompt, '-W', String(W), '-H', String(H), '-o', outPath, ...extraArgs);

  await runSdCli(bin, args, { onLog, onProgress });

  let buffer;
  try {
    buffer = await fs.readFile(outPath);
  } catch {
    throw new Error('sd-cli terminó pero no generó el archivo de salida esperado.');
  } finally {
    await fs.unlink(outPath).catch(() => {});
  }
  return [{ buffer, mime: 'image/png' }];
}
