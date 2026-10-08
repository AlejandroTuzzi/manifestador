import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadHeyGenAssetWithKey, downloadHeyGenVideo } from './heygen.js';

export const heygenSceneError = (code, status = 400) => Object.assign(new Error(code), {localizationCode:code,status});
export function heygenScenePayload({prompt, mode = 'reference', mediaRefs = [], duration = 5, resolution = '768p', aspectRatio = '16:9', options = {}}) {
  const bad = () => { throw heygenSceneError('heygenSceneParameters'); };
  if (!String(prompt || '').trim() || prompt.length > 32000 || !Number.isInteger(duration) || duration < 5 || duration > 15) bad();
  if (!['480p','768p','1080p','2k'].includes(resolution) || !['reference','first'].includes(mode)) bad();
  if (!['16:9','9:16','21:9','4:3','3:4','1:1','adaptive'].includes(aspectRatio)) bad();
  if (mode !== 'first' && ['1080p','2k'].includes(resolution) && !['16:9','9:16'].includes(aspectRatio)) bad();
  const counts = {image:0, video:0, audio:0};
  for (const ref of mediaRefs) { if (!(ref.kind in counts)) bad(); counts[ref.kind]++; }
  if (mediaRefs.length > 12 || counts.image > 9 || counts.video > 3 || counts.audio > 3 || (counts.audio && !counts.image && !counts.video)) bad();
  if (mode === 'first' && (mediaRefs.length !== 1 || counts.image !== 1)) bad();
  const enhancement = options.promptEnhancement ?? 'disabled';
  if (!['disabled','turbo','quality'].includes(enhancement)) bad();
  const payload = {model:'heygen-video-1', prompt:String(prompt).replace(/(?<!<)\b(Image|Video|Audio)\s+(\d+)\b(?!>)/g, (_,kind,n) => `<${kind === 'Image' ? 'Picture' : kind} ${n}>`),
    mode:mode === 'first' ? 'image_to_video' : mediaRefs.length ? 'reference_to_video' : 'text_to_video',duration,resolution,prompt_enhancement:enhancement};
  if (mode !== 'first') payload.aspect_ratio = aspectRatio === 'adaptive' && !mediaRefs.length ? '16:9' : aspectRatio;
  if (options.seed !== undefined && options.seed !== '') {
    const seed = Number(options.seed); if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) bad(); payload.seed = seed;
  }
  return payload;
}

export async function generateHeygenScene(input, deps = {}) {
  const {apiKey, taskId, idempotencyKey, onTask = async()=>{}, onFailed = async()=>{}} = input;
  if (!apiKey) throw heygenSceneError('heygenApiKeyMissing');
  const request = deps.fetch || fetch;
  const json = async (route, body) => {
    const response = await request('https://api.heygen.com/v3/models/videos' + route, {method:body ? 'POST':'GET',
      headers:{'x-api-key':apiKey,'Content-Type':'application/json',...(body ? {'Idempotency-Key':idempotencyKey}: {})},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(60000)});
    const result = await response.json().catch(()=>null);
    if (!response.ok || !result?.data) {
      const error = heygenSceneError('heygenSceneResponse', response.status >= 400 ? response.status : 502);
      error.message = result?.error?.message || error.message; throw error;
    }
    return result.data;
  };
  let id = taskId;
  if (!id) {
    if (!idempotencyKey) throw heygenSceneError('heygenSceneParameters');
    const payload = heygenScenePayload(input);
    for (const [index, ref] of (input.mediaRefs || []).entries()) {
      if (String(ref.path).startsWith('asset://')) throw heygenSceneError('heygenSceneParameters');
      const inline = /^data:([^;]+);base64,(.+)$/s.exec(String(ref.path));
      const buffer = inline ? Buffer.from(inline[2],'base64') : await (deps.readFile || readFile)(ref.path);
      if (buffer.length > (ref.kind === 'image' ? 16 : 32) * 1024 * 1024) throw heygenSceneError('heygenSceneParameters');
      const ext = inline ? '.png' : path.extname(ref.path).toLowerCase();
      const mime = inline?.[1] || ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4'})[ext];
      if (!mime || !mime.startsWith(ref.kind + '/')) throw heygenSceneError('heygenSceneParameters');
      const uploaded = await (deps.upload || uploadHeyGenAssetWithKey)({apiKey,buffer,filename:`reference-${index}${ext}`,mime,idempotencyKey:`${idempotencyKey}-ref-${index}`});
      if (!uploaded.asset_id) throw heygenSceneError('heygenSceneResponse',502);
      const asset = {type:'asset_id',asset_id:uploaded.asset_id};
      if (payload.mode === 'image_to_video') payload.image = asset;
      else (payload[ref.kind === 'image' ? 'reference_images' : ref.kind === 'video' ? 'reference_videos' : 'reference_audio'] ||= []).push(asset);
    }
    id = (await json('',payload)).video_id;
    if (!id) throw heygenSceneError('heygenSceneResponse',502);
    await onTask(id);
  }
  const deadline = Date.now() + (deps.timeoutMs ?? 20*60*1000);
  while(Date.now() < deadline) {
    const result = await json('/' + encodeURIComponent(id));
    if (['failed','cancelled'].includes(result.status)) { await onFailed(id); throw heygenSceneError('heygenSceneFailed',502); }
    if (result.status === 'completed' && result.video_url) return {buffer:await (deps.download || downloadHeyGenVideo)(result.video_url),taskId:id,seed:result.seed,usage:{output_seconds:result.duration || input.duration},finalPrompt:input.prompt};
    await (deps.sleep || (ms=>new Promise(resolve=>setTimeout(resolve,ms))))(5000);
  }
  throw heygenSceneError('heygenScenePending',504);
}
