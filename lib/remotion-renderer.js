import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY_POINT = path.join(ROOT, 'remotion', 'index.jsx');
let bundledProject = null;

async function remotionBundle() {
  if (!bundledProject) {
    bundledProject = bundle({
      entryPoint: ENTRY_POINT,
      onProgress: () => undefined
    }).catch((error) => {
      bundledProject = null;
      throw error;
    });
  }
  return bundledProject;
}

export async function renderDynamicTextOverlay({ outputPath, inputProps, onProgress = () => undefined }) {
  const serveUrl = await remotionBundle();
  const composition = await selectComposition({
    serveUrl,
    id: 'ManifestadorDynamicText',
    inputProps
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    outputLocation: outputPath,
    codec: 'vp8',
    imageFormat: 'png',
    pixelFormat: 'yuva420p',
    muted: true,
    concurrency: '50%',
    logLevel: 'warn',
    overwrite: true,
    onProgress: ({ progress }) => onProgress(progress)
  });
  return outputPath;
}
