// Catálogo de modelos y sus restricciones.
// Cada entrada define qué tolera el modelo: proporciones, resoluciones y
// cantidad de imágenes de referencia. El frontend se adapta a esto.

export const IMAGE_MODELS = [
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    provider: 'gemini',
    apiModel: 'gemini-3-pro-image',
    keyName: 'gemini',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    resolutions: ['1K', '2K', '4K'],
    maxRefs: 14,
    minRefs: 0,
    notes: 'Gemini 3 Pro Image. Producción profesional, razonamiento avanzado, texto preciso y hasta 4K.'
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    provider: 'gemini',
    apiModel: 'gemini-3.1-flash-image',
    keyName: 'gemini',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    resolutions: ['1K', '2K', '4K'],
    maxRefs: 14,
    minRefs: 0,
    notes: 'Gemini 3.1 Flash Image. Hasta 4K y 14 imágenes de referencia.'
  },
  {
    id: 'nano-banana-2-lite',
    name: 'Nano Banana 2 Lite',
    provider: 'gemini',
    apiModel: 'gemini-3.1-flash-lite-image',
    keyName: 'gemini',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    resolutions: ['1K'],
    maxRefs: 14,
    minRefs: 0,
    notes: 'El más barato y rápido de la familia. Solo 1K.'
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'openai',
    apiModel: 'gpt-image-2',
    keyName: 'openai',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    resolutions: ['1K', '2K', '4K'],
    maxRefs: 16,
    minRefs: 0,
    notes: 'OpenAI. Fotorrealismo y texto en imagen impecables; hasta 16 referencias. 1K usa calidad media (barata); 2K y 4K calidad alta (caras). El área máxima es ~8 MP: en 1:1 el "4K" real es 2880×2880.'
  },
  {
    id: 'seedream-5-lite',
    name: 'Seedream 5.0 Lite',
    provider: 'seedream',
    apiModel: 'seedream-5-0-lite',
    keyName: 'ark',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
    resolutions: ['2K', '4K'],
    maxRefs: 10,
    minRefs: 0,
    notes: 'ByteDance vía BytePlus ModelArk. Exige mínimo ~3.7 MP, por eso arranca en 2K. El ID exacto del modelo se ajusta en Configuración.'
  }
];

export const VIDEO_MODELS = [
  {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    provider: 'seedance',
    apiModel: 'dreamina-seedance-2-0-260128',
    keyName: 'ark',
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 6, 8, 10, 12, 15],
    maxRefs: 6,
    refLimits: { reference: 6, frames: 2 },
    minRefs: 0,
    audio: true,
    notes: 'ByteDance vía BytePlus ModelArk. Video con audio sincronizado. Modo Referencias: mencioná las imágenes con @image1, @image2… en el prompt. El ID exacto se ajusta en Configuración.'
  },
  {
    id: 'seedance-2-mini',
    name: 'Seedance 2.0 Mini',
    provider: 'seedance',
    apiModel: 'dreamina-seedance-2-0-mini-260615',
    keyName: 'ark',
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    resolutions: ['480p', '720p'],
    durations: [4, 5, 6, 8, 10, 12],
    maxRefs: 6,
    refLimits: { reference: 6, frames: 2 },
    minRefs: 0,
    audio: false,
    notes: 'La variante económica: ideal para iterar barato antes de tirar la versión final con el grande. Hasta 720p, sin audio. El ID exacto se ajusta en Configuración.'
  }
];

export function getVideoModel(id) {
  return VIDEO_MODELS.find((m) => m.id === id) || null;
}

export const AUDIO_MODELS = [
  {
    id: 'eleven-v3',
    name: 'Eleven v3',
    provider: 'elevenlabs',
    apiModel: 'eleven_v3',
    keyName: 'elevenlabs',
    supportsAudioTags: true,
    notes: 'Más expresivo. Admite indicaciones de interpretación entre corchetes.'
  },
  {
    id: 'eleven-multilingual-v2',
    name: 'Eleven Multilingual v2',
    provider: 'elevenlabs',
    apiModel: 'eleven_multilingual_v2',
    keyName: 'elevenlabs',
    supportsAudioTags: false,
    notes: 'Más estable para narraciones y voces que conservan mejor su identidad con v2.'
  }
];

// Alias conservado para los proyectos e historiales anteriores, cuyo modelo
// implícito siempre fue Eleven v3.
export const AUDIO_MODEL = AUDIO_MODELS[0];

export function getAudioModel(id) {
  return AUDIO_MODELS.find((model) => model.id === id || model.apiModel === id) || AUDIO_MODEL;
}

// Música con Suno (vía proveedor tipo sunoapi.org). Genera 2 variantes por
// pedido. Versiones de modelo de menor a mayor; V5_5 es la más avanzada.
export const MUSIC_MODEL = {
  id: 'suno',
  name: 'Suno',
  provider: 'suno',
  keyName: 'suno',
  versions: ['V4', 'V4_5', 'V4_5PLUS', 'V4_5ALL', 'V5', 'V5_5'],
  defaultVersion: 'V5_5',
  notes: 'Suno vía proveedor externo (URL y key en Configuración). Modo custom: letra + estilo/género + título. También instrumental. Genera 2 variantes por pedido.'
};

export function getImageModel(id) {
  return IMAGE_MODELS.find((m) => m.id === id) || null;
}
