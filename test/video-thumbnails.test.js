import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(count = 30) {
  const img = id => ({ dataset:{ videoThumbnail:'/file/' + id }, isConnected:true, src:'', getClientRects:() => [1], matches:() => true, querySelectorAll:() => [] });
  const images = Array.from({ length:count }, (_,i) => img(i));
  const videos = [], timers = new Map(), observed = new Set();
  let visible, mutate, seq = 0;
  const context = {
    IntersectionObserver:class { constructor(cb) { visible = cb; } observe(node) { observed.add(node); } unobserve(node) { observed.delete(node); } },
    MutationObserver:class { constructor(cb) { mutate = cb; } observe() {} },
    setTimeout:cb => { timers.set(++seq,cb); return seq; }, clearTimeout:id => timers.delete(id),
    document:{ hidden:false, body:{ querySelectorAll:() => images }, addEventListener() {}, createElement:tag => {
      if (tag === 'canvas') return { getContext:() => ({ drawImage() {} }), toDataURL:() => 'data:image/jpeg;cached' };
      const video = { videoWidth:1920,videoHeight:1080,load() {},pause() {},removeAttribute() { this.released = true; } };
      videos.push(video); return video;
    } }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/video-thumbnails.js',import.meta.url),'utf8'),context);
  return { images, videos, timers, observed, img, show:items => visible(items.map(target => ({ target,isIntersecting:true }))), hide:items => visible(items.map(target => ({ target,isIntersecting:false }))), mutate:record => mutate([record]) };
}
test('gallery opens no videos until visible, and decodes only one at a time', () => {
  const h = harness(200);
  assert.equal(h.videos.length,0);
  h.show(h.images.slice(0,20));
  assert.equal(h.videos.length,1);
  h.videos[0].onloadeddata();
  assert.ok(h.videos[0].released);
  assert.equal(h.images[0].src,'data:image/jpeg;cached');
  assert.equal(h.videos.length,2);
});
test('offscreen queued videos are skipped and broken files release the queue', () => {
  const h = harness(4);
  h.show(h.images);
  h.hide([h.images[1],h.images[2]]);
  h.videos[0].onerror();
  assert.equal(h.videos[1].src,h.images[3].dataset.videoThumbnail);
  [...h.timers.values()][0]();
  assert.ok(h.videos[1].released);
  assert.equal(h.timers.size,0);
});
test('cached previews survive rerender and removed tiles release decoding resources', () => {
  const h = harness(2);
  h.show(h.images); h.videos[0].onloadeddata();
  const replacement = h.img(0);
  h.mutate({ removedNodes:[],addedNodes:[replacement] });
  assert.equal(replacement.src,'data:image/jpeg;cached');
  assert.equal(h.videos.length,2);
  h.images[1].isConnected = false;
  h.mutate({ removedNodes:[h.images[1]],addedNodes:[] });
  assert.ok(h.videos[1].released);
  assert.equal(h.observed.has(h.images[1]),false);
});
test('asset video category and video reference picker use images instead of eager players', () => {
  const app = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const branch = app.slice(app.indexOf("} else if (state.assetsZone === 'video')"), app.indexOf('const STYLE_CATEGORY'));
  assert.match(branch,/data-video-thumbnail/);
  assert.doesNotMatch(branch,/<video/);
  assert.match(app,/thumbnailVersion/);
});
