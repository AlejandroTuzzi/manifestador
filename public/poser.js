// ---------------------------------------------------------------------------
// Poser: visor y posador de modelos XNALara/XPS al estilo XNALara.
// Módulo ES aparte de app.js; se comunica con el resto de la app a través
// de window.manifestadorBridge (definido al final de app.js).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { TGALoader } from './vendor/TGALoader.js';
import { DDSLoader } from './vendor/DDSLoader.js';
import { parseXps, parsePoseFile, serializePose } from './poser-xps.js';

const B = window.manifestadorBridge;
const $ = (s) => document.querySelector(s);

const P = {
  ready: false,
  models: [],
  poses: [],
  model: null,          // modelo seleccionado (registro del server)
  boneObjs: [],         // THREE.Bone en orden del archivo
  restLocal: [],        // posición local de reposo de cada hueso
  root: null,           // Group con el modelo actual
  skeleton: null,
  selectedBone: -1,
  soloDots: false,      // seleccionado por etiqueta: solo se ve el punto activo
  aliases: {},          // { modelId: { nombreHueso: etiqueta } }
  meshItems: [],        // meshes del modelo con su grupo de "parte/ropa"
  modelSize: 1,
  boneSearch: '',
  renderer: null, scene: null, camera: null, controls: null,
  grid: null, bonePoints: null, boneMarker: null,
  home: null            // posición inicial de cámara para "centrar"
};

const modelFileKey = (name) => `poser-models/${P.model.id}/${name}`;
const deg = (rad) => rad * 180 / Math.PI;
const rad = (d) => d * Math.PI / 180;

// ---------------------------------------------------------------------------
// escena three.js
// ---------------------------------------------------------------------------

function initViewer() {
  if (P.ready) return;
  P.ready = true;
  const canvas = $('#poserCanvas');
  P.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  P.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  P.scene = new THREE.Scene();
  P.scene.background = new THREE.Color($('#poserBg').value);
  P.camera = new THREE.PerspectiveCamera(Number($('#poserFov').value), 1, 0.01, 5000);
  P.camera.position.set(0, 6, 18);
  P.controls = new OrbitControls(P.camera, canvas);
  P.controls.enableDamping = true;

  P.scene.add(new THREE.HemisphereLight(0xffffff, 0x554466, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 10, 7);
  P.scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbfa8ff, 0.5);
  fill.position.set(-6, 4, -6);
  P.scene.add(fill);

  P.grid = new THREE.GridHelper(20, 20, 0x8b5cf6, 0x3a2b4d);
  P.grid.material.transparent = true;
  P.grid.material.opacity = 0.4;
  P.scene.add(P.grid);

  const wrap = $('#poserCanvasWrap');
  const resize = () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    P.renderer.setSize(w, h, false);
    P.camera.aspect = w / h;
    P.camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(wrap);
  resize();

  P.renderer.setAnimationLoop(() => {
    P.controls.update();
    updateBoneOverlay();
    P.renderer.render(P.scene, P.camera);
  });

  // clic sobre un punto de hueso = seleccionarlo (se distingue de arrastrar)
  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
    down = null;
    if (!P.bonePoints || !$('#poserShowBones').checked) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, P.camera);
    ray.params.Points.threshold = P.modelSize * 0.02;
    const hit = ray.intersectObject(P.bonePoints)[0];
    if (hit) selectBone(hit.index);
  });
}

function disposeModel() {
  if (P.root) {
    P.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    P.scene.remove(P.root);
  }
  if (P.bonePoints) { P.scene.remove(P.bonePoints); P.bonePoints.geometry.dispose(); P.bonePoints.material.dispose(); P.bonePoints = null; }
  if (P.boneMarker) { P.scene.remove(P.boneMarker); P.boneMarker = null; }
  P.root = null; P.skeleton = null; P.boneObjs = []; P.restLocal = []; P.selectedBone = -1;
  P.meshItems = []; P.soloDots = false;
  renderBoneList(); renderBoneControls(); renderParts(); renderAliasChips();
}

// DDS: DXT1/3/5 vía DDSLoader (comprimida, no admite flipY en GPU: se compensa
// con la transformación UV) y RGB/RGBA sin comprimir decodificada a mano.
async function loadDds(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const fourcc = String.fromCharCode(dv.getUint8(84), dv.getUint8(85), dv.getUint8(86), dv.getUint8(87));
  const pfFlags = dv.getUint32(80, true);
  if (fourcc.startsWith('DXT')) {
    const dds = new DDSLoader().parse(buf, true);
    const tex = new THREE.CompressedTexture(dds.mipmaps, dds.width, dds.height, dds.format);
    tex.minFilter = dds.mipmapCount > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.repeat.y = -1;
    tex.offset.y = 1;
    tex.needsUpdate = true;
    return tex;
  }
  if (pfFlags & 0x40) { // DDPF_RGB sin comprimir (BGR o BGRA)
    const w = dv.getUint32(16, true), h = dv.getUint32(12, true);
    const bpp = dv.getUint32(88, true) / 8;
    const hasAlpha = Boolean(pfFlags & 0x1) && bpp === 4;
    const src = new Uint8Array(buf, 128, w * h * bpp);
    const out = new Uint8Array(w * h * 4);
    for (let i = 0, o = 0; o < out.length; i += bpp, o += 4) {
      out[o] = src[i + 2]; out[o + 1] = src[i + 1]; out[o + 2] = src[i]; out[o + 3] = hasAlpha ? src[i + 3] : 255;
    }
    const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
    tex.flipY = true;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
  throw new Error('Variante de DDS no soportada');
}

function assignTexture(mat, file) {
  const wanted = String(file).toLowerCase();
  const found = (P.model.files || []).find((f) => f.name.split('/').pop().toLowerCase() === wanted);
  if (!found) return;
  const url = B.fileUrl(modelFileKey(found.name));
  const apply = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    if (!tex.isCompressedTexture) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  };
  if (/\.dds$/i.test(found.name)) {
    loadDds(url).then(apply).catch((e) => console.warn(`Textura ${found.name}: ${e.message}`));
  } else {
    const loader = /\.tga$/i.test(found.name) ? new TGALoader() : new THREE.TextureLoader();
    apply(loader.load(url));
  }
}

function buildModel(parsed) {
  disposeModel();
  P.root = new THREE.Group();
  P.scene.add(P.root);
  const hasBones = parsed.bones.length > 0;

  if (hasBones) {
    P.boneObjs = parsed.bones.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      return bone;
    });
    parsed.bones.forEach((b, i) => {
      const parentOk = b.parent >= 0 && b.parent < parsed.bones.length && b.parent !== i;
      const parentPos = parentOk ? parsed.bones[b.parent].position : [0, 0, 0];
      const local = new THREE.Vector3(b.position[0] - parentPos[0], b.position[1] - parentPos[1], b.position[2] - parentPos[2]);
      P.boneObjs[i].position.copy(local);
      P.restLocal[i] = local.clone();
      if (parentOk) P.boneObjs[b.parent].add(P.boneObjs[i]);
      else P.root.add(P.boneObjs[i]);
    });
    P.root.updateMatrixWorld(true);
    P.skeleton = new THREE.Skeleton(P.boneObjs);
  }

  for (const m of parsed.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    // las UV de XPS vienen en convención DirectX (V hacia abajo)
    const uvs = new Float32Array(m.uvs.length);
    for (let i = 0; i < m.uvs.length; i += 2) { uvs[i] = m.uvs[i]; uvs[i + 1] = 1 - m.uvs[i + 1]; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));

    const mat = new THREE.MeshPhongMaterial({
      color: 0xb9a7cf,
      specular: new THREE.Color(0x222222),
      shininess: Math.max(1, (m.specular || 0.1) * 60),
      side: THREE.DoubleSide,
      alphaTest: 0.35
    });
    if (m.textures.length) assignTexture(mat, m.textures[0].file);

    if (hasBones && m.skinIndices) {
      const idx = new Uint16Array(m.skinIndices.length);
      const wgt = new Float32Array(m.skinWeights.length);
      for (let v = 0; v < m.skinIndices.length; v += 4) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += m.skinWeights[v + k];
        for (let k = 0; k < 4; k++) {
          idx[v + k] = Math.min(m.skinIndices[v + k], P.boneObjs.length - 1);
          wgt[v + k] = sum > 0 ? m.skinWeights[v + k] / sum : (k === 0 ? 1 : 0);
        }
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.name = m.name;
      mesh.frustumCulled = false;
      P.root.add(mesh);
      mesh.bind(P.skeleton, new THREE.Matrix4());
      registerMeshItem(mesh, m.name);
    } else {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = m.name;
      P.root.add(mesh);
      registerMeshItem(mesh, m.name);
    }
  }

  // encuadre inicial según el tamaño real del modelo
  const box = new THREE.Box3().setFromObject(P.root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  P.modelSize = Math.max(size.x, size.y, size.z) || 1;
  P.grid.position.y = box.min.y;
  P.grid.scale.setScalar(P.modelSize / 10);
  const dist = (P.modelSize / 2) / Math.tan(rad(P.camera.fov / 2)) * 1.5;
  P.camera.position.set(center.x, center.y + size.y * 0.05, center.z + dist);
  P.camera.near = P.modelSize / 200;
  P.camera.far = P.modelSize * 100;
  P.camera.updateProjectionMatrix();
  P.controls.target.copy(center);
  P.home = { position: P.camera.position.clone(), target: center.clone() };

  if (hasBones) {
    const pts = new THREE.BufferGeometry();
    pts.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.boneObjs.length * 3), 3));
    const ptsMat = new THREE.PointsMaterial({ color: 0x8b5cf6, size: P.modelSize * 0.014, depthTest: false, transparent: true, opacity: 0.9 });
    P.bonePoints = new THREE.Points(pts, ptsMat);
    P.bonePoints.renderOrder = 998;
    P.bonePoints.frustumCulled = false;
    P.scene.add(P.bonePoints);
    const marker = new THREE.BufferGeometry();
    marker.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    P.boneMarker = new THREE.Points(marker, new THREE.PointsMaterial({ color: 0xec4899, size: P.modelSize * 0.028, depthTest: false }));
    P.boneMarker.renderOrder = 999;
    P.boneMarker.frustumCulled = false;
    P.boneMarker.visible = false;
    P.scene.add(P.boneMarker);
  }

  renderBoneList();
  renderBoneControls();
  renderParts();
  renderAliasChips();
}

// Convención XNALara: los meshes "+Grupo.item" / "-Grupo.item" son partes
// opcionales (ropa, accesorios); "+" arranca visible y "-" oculto.
function registerMeshItem(mesh, rawName) {
  const optional = /^[+-]/.test(rawName);
  mesh.visible = !rawName.startsWith('-');
  const group = optional ? (rawName.slice(1).split('.')[0] || rawName.slice(1)) : rawName;
  P.meshItems.push({ mesh, optional, group });
}

function renderParts() {
  const box = $('#poserPartsList');
  if (!P.meshItems.length) {
    box.innerHTML = '<div class="hint">Cargá un modelo para ver sus partes.</div>';
    return;
  }
  const groups = new Map();
  for (const item of P.meshItems) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  const entries = [...groups.entries()].sort((a, b) => {
    const optA = a[1][0].optional, optB = b[1][0].optional;
    if (optA !== optB) return optA ? -1 : 1; // las opcionales (ropa) primero
    return a[0].localeCompare(b[0]);
  });
  box.innerHTML = entries.map(([group, items], i) =>
    `<label class="poser-part"><input type="checkbox" data-part="${i}" ${items.some((x) => x.mesh.visible) ? 'checked' : ''}> ${B.esc(group)}${items.length > 1 ? ` <span class="hint">(${items.length})</span>` : ''}</label>`
  ).join('');
  const lists = entries.map(([, items]) => items);
  box.querySelectorAll('[data-part]').forEach((cb) => cb.addEventListener('change', () => {
    for (const item of lists[Number(cb.dataset.part)]) item.mesh.visible = cb.checked;
  }));
}

const tmpV = new THREE.Vector3();
function updateBoneOverlay() {
  if (!P.bonePoints) return;
  const show = $('#poserShowBones').checked;
  const solo = P.soloDots && P.selectedBone >= 0;
  P.bonePoints.visible = show && !solo;
  if (!show) { if (P.boneMarker) P.boneMarker.visible = false; return; }
  if (P.bonePoints.visible) {
    const arr = P.bonePoints.geometry.attributes.position.array;
    P.boneObjs.forEach((bone, i) => {
      bone.getWorldPosition(tmpV);
      arr[i * 3] = tmpV.x; arr[i * 3 + 1] = tmpV.y; arr[i * 3 + 2] = tmpV.z;
    });
    P.bonePoints.geometry.attributes.position.needsUpdate = true;
  }
  if (P.selectedBone >= 0) {
    P.boneObjs[P.selectedBone].getWorldPosition(tmpV);
    P.boneMarker.geometry.attributes.position.array.set([tmpV.x, tmpV.y, tmpV.z]);
    P.boneMarker.geometry.attributes.position.needsUpdate = true;
    P.boneMarker.visible = true;
  } else {
    P.boneMarker.visible = false;
  }
}

// ---------------------------------------------------------------------------
// huesos: lista, selección y sliders
// ---------------------------------------------------------------------------

function renderBoneList() {
  const list = $('#poserBoneList');
  if (!P.boneObjs.length) {
    list.innerHTML = '<div class="hint" style="padding:8px">Cargá un modelo para ver sus huesos.</div>';
    return;
  }
  const q = P.boneSearch.toLowerCase();
  const rows = P.boneObjs
    .map((bone, i) => ({ bone, i }))
    .filter(({ bone }) => !q || bone.name.toLowerCase().includes(q));
  list.innerHTML = rows.map(({ bone, i }) => {
    const touched = bone.rotation.x !== 0 || bone.rotation.y !== 0 || bone.rotation.z !== 0;
    return `<button class="poser-bone${i === P.selectedBone ? ' active' : ''}" data-bone="${i}">${touched ? '● ' : ''}${B.esc(bone.name)}</button>`;
  }).join('') || '<div class="hint" style="padding:8px">Ningún hueso coincide.</div>';
  list.querySelectorAll('[data-bone]').forEach((btn) => btn.addEventListener('click', () => selectBone(Number(btn.dataset.bone))));
}

function selectBone(i, solo = false) {
  P.selectedBone = i;
  P.soloDots = solo;
  renderBoneList();
  renderBoneControls();
  renderAliasChips();
  const active = $('#poserBoneList .poser-bone.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function renderBoneControls() {
  const box = $('#poserBoneCtl');
  const bone = P.boneObjs[P.selectedBone];
  box.hidden = !bone;
  if (!bone) return;
  $('#poserBoneName').textContent = bone.name;
  $('#poserAliasInput').value = (P.aliases[P.model?.id] || {})[bone.name] || '';
  for (const [axis, id] of [['x', '#poserRotX'], ['y', '#poserRotY'], ['z', '#poserRotZ']]) {
    const input = $(id);
    input.value = Math.round(deg(bone.rotation[axis]));
    input.nextElementSibling.textContent = `${Math.round(deg(bone.rotation[axis]))}°`;
  }
}

for (const [axis, id] of [['x', '#poserRotX'], ['y', '#poserRotY'], ['z', '#poserRotZ']]) {
  document.addEventListener('input', (e) => {
    if (e.target.id !== id.slice(1)) return;
    const bone = P.boneObjs[P.selectedBone];
    if (!bone) return;
    bone.rotation[axis] = rad(Number(e.target.value));
    e.target.nextElementSibling.textContent = `${e.target.value}°`;
  });
}

// Etiquetas rápidas: alias por hueso ("Wrightneck" → "Control Cuello").
// Al elegir una, se ocultan todos los puntos salvo el del hueso activo.
function renderAliasChips() {
  const box = $('#poserAliasChips');
  const map = P.aliases[P.model?.id] || {};
  const byName = new Map(P.boneObjs.map((bone, i) => [bone.name, i]));
  const entries = Object.entries(map).filter(([bone]) => byName.has(bone));
  box.hidden = !entries.length;
  if (box.hidden) { box.innerHTML = ''; return; }
  box.innerHTML = entries
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([bone, label]) => `<button class="poser-chip${byName.get(bone) === P.selectedBone ? ' active' : ''}" data-alias-bone="${B.esc(bone)}" title="${B.esc(bone)}">${B.esc(label)}</button>`)
    .join('');
  box.querySelectorAll('[data-alias-bone]').forEach((chip) => chip.addEventListener('click', () => {
    selectBone(byName.get(chip.dataset.aliasBone), true);
  }));
}

$('#poserAliasSave').addEventListener('click', async () => {
  const bone = P.boneObjs[P.selectedBone];
  if (!bone || !P.model) return;
  const label = $('#poserAliasInput').value.trim();
  const { aliases } = await B.api('/api/poser/aliases', { method: 'PUT', body: { modelId: P.model.id, bone: bone.name, label } });
  P.aliases = aliases;
  renderAliasChips();
  B.toast(label ? `Etiqueta "${label}" guardada` : 'Etiqueta borrada');
});
$('#poserAliasInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#poserAliasSave').click(); });

$('#poserBoneWinClose').addEventListener('click', () => {
  P.selectedBone = -1;
  P.soloDots = false;
  renderBoneList();
  renderBoneControls();
  renderAliasChips();
});

// la ventana de hueso se puede arrastrar desde su encabezado
{
  const win = $('#poserBoneCtl');
  const head = $('#poserBoneWinHead');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = win.getBoundingClientRect();
    const wrap = $('#poserCanvasWrap').getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, wrap };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    win.style.left = `${Math.max(0, Math.min(e.clientX - drag.wrap.left - drag.dx, drag.wrap.width - 60))}px`;
    win.style.top = `${Math.max(0, Math.min(e.clientY - drag.wrap.top - drag.dy, drag.wrap.height - 40))}px`;
    win.style.right = 'auto';
  });
  head.addEventListener('pointerup', () => { drag = null; });
}

function resetPose() {
  P.boneObjs.forEach((bone, i) => {
    bone.rotation.set(0, 0, 0);
    bone.position.copy(P.restLocal[i]);
  });
  renderBoneControls();
  renderBoneList();
}

function getPoseData() {
  const out = {};
  P.boneObjs.forEach((bone, i) => {
    const rot = [deg(bone.rotation.x), deg(bone.rotation.y), deg(bone.rotation.z)];
    const pos = [bone.position.x - P.restLocal[i].x, bone.position.y - P.restLocal[i].y, bone.position.z - P.restLocal[i].z];
    if (rot.some((v) => Math.abs(v) > 0.01) || pos.some((v) => Math.abs(v) > 0.0001)) {
      out[bone.name] = { rot: rot.map((v) => Math.round(v * 1000) / 1000), pos };
    }
  });
  return out;
}

function applyPoseData(bones) {
  resetPose();
  const byName = new Map(P.boneObjs.map((bone, i) => [bone.name.trim().toLowerCase(), i]));
  let applied = 0;
  for (const [name, data] of Object.entries(bones || {})) {
    const i = byName.get(String(name).trim().toLowerCase());
    if (i === undefined) continue;
    const bone = P.boneObjs[i];
    bone.rotation.set(rad(data.rot[0]), rad(data.rot[1]), rad(data.rot[2]));
    if (data.pos) bone.position.set(P.restLocal[i].x + data.pos[0], P.restLocal[i].y + data.pos[1], P.restLocal[i].z + data.pos[2]);
    applied++;
  }
  renderBoneControls();
  renderBoneList();
  return applied;
}

// ---------------------------------------------------------------------------
// modelos: subir carpeta, elegir, borrar
// ---------------------------------------------------------------------------

async function refreshPoser() {
  const data = await B.api('/api/poser');
  P.models = data.models;
  P.poses = data.poses;
  P.aliases = data.aliases || {};
  $('#poserFolderHint').textContent = P.models.length
    ? ''
    : `Copiá cada modelo (su carpeta con el .xps/.mesh y las texturas) dentro de ${data.folder} y tocá "Releer carpeta".`;
  const sel = $('#poserModelSelect');
  const prev = P.model?.id || localStorage.getItem('poserModelId') || '';
  sel.innerHTML = P.models.length
    ? P.models.map((m) => `<option value="${B.esc(m.id)}">${B.esc(m.name)}</option>`).join('')
    : '<option value="">— sin modelos —</option>';
  const pick = P.models.find((m) => m.id === prev) || P.models[0] || null;
  if (pick) sel.value = pick.id;
  if (pick && pick.id !== P.model?.id) await loadModel(pick);
  renderSceneList();
}

async function loadModel(model) {
  P.model = model;
  localStorage.setItem('poserModelId', model.id);
  if (!model.meshFile) { $('#poserStatus').textContent = 'Este modelo no tiene archivo de malla.'; return; }
  $('#poserStatus').textContent = 'Cargando modelo…';
  try {
    const res = await fetch(B.fileUrl(modelFileKey(model.meshFile)));
    if (!res.ok) throw new Error('No pude descargar la malla.');
    const parsed = parseXps(await res.arrayBuffer(), model.meshFile);
    buildModel(parsed);
    $('#poserStatus').textContent = `${parsed.bones.length} huesos · ${parsed.meshes.length} meshes`;
  } catch (e) {
    $('#poserStatus').textContent = '';
    B.toast(`No pude cargar el modelo: ${e.message}`, 'err');
  }
}

$('#poserModelSelect').addEventListener('change', (e) => {
  const model = P.models.find((m) => m.id === e.target.value);
  if (model) loadModel(model);
});

$('#poserRefreshModels').addEventListener('click', async () => {
  P.model = null; // fuerza recargar el modelo seleccionado desde el disco
  await refreshPoser();
  B.toast('Carpeta de modelos releída');
});

// ---------------------------------------------------------------------------
// cámara: lente (FOV) y encuadre
// ---------------------------------------------------------------------------

function lensName(fov) {
  if (fov <= 20) return 'teleobjetivo';
  if (fov <= 35) return 'retrato';
  if (fov <= 55) return 'normal';
  if (fov <= 85) return 'gran angular';
  return 'ojo de pez';
}

function updateFovLabel() {
  const fov = Number($('#poserFov').value);
  const mm = Math.round(12 / Math.tan(rad(fov / 2)));
  $('#poserFovLabel').textContent = `${fov}° · ~${mm}mm · ${lensName(fov)}`;
}

$('#poserFov').addEventListener('input', () => {
  if (!P.camera) return;
  P.camera.fov = Number($('#poserFov').value);
  P.camera.updateProjectionMatrix();
  updateFovLabel();
});

$('#poserResetCam').addEventListener('click', () => {
  if (!P.home) return;
  P.camera.position.copy(P.home.position);
  P.controls.target.copy(P.home.target);
});

$('#poserBg').addEventListener('change', (e) => {
  if (P.scene) P.scene.background = new THREE.Color(e.target.value);
});

$('#poserBoneSearch').addEventListener('input', (e) => {
  P.boneSearch = e.target.value;
  renderBoneList();
});

// re-tildar "ver puntos" también saca el modo "solo el activo"
$('#poserShowBones').addEventListener('change', () => { P.soloDots = false; });

$('#poserResetPose').addEventListener('click', resetPose);
$('#poserBoneReset').addEventListener('click', () => {
  const bone = P.boneObjs[P.selectedBone];
  if (!bone) return;
  bone.rotation.set(0, 0, 0);
  bone.position.copy(P.restLocal[P.selectedBone]);
  renderBoneControls();
  renderBoneList();
});

// ---------------------------------------------------------------------------
// poses: importar/exportar .pose, capturar, escenas guardadas
// ---------------------------------------------------------------------------

$('#poserImportPose').addEventListener('click', () => $('#poserPoseInput').click());
$('#poserPoseInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !P.boneObjs.length) return;
  const parsed = parsePoseFile(await file.text());
  const applied = applyPoseData(Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, { rot: v.rot, pos: v.pos }])));
  B.toast(applied ? `Pose aplicada a ${applied} huesos` : 'Ningún hueso del .pose coincide con este modelo', applied ? 'ok' : 'err');
});

$('#poserExportPose').addEventListener('click', () => {
  if (!P.boneObjs.length) return;
  const blob = new Blob([serializePose(getPoseData())], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(P.model?.name || 'pose').replace(/\s+/g, '-')}.pose`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function captureDataUrl() {
  P.renderer.render(P.scene, P.camera);
  const src = P.renderer.domElement;
  if (!$('#poserGray').checked) return src.toDataURL('image/png');
  // en grises: la IA la toma como referencia de pose sin copiar colores/ropa
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1)';
  ctx.drawImage(src, 0, 0);
  return c.toDataURL('image/png');
}

$('#poserGray').addEventListener('change', (e) => localStorage.setItem('poserGray', e.target.checked ? '1' : ''));
if (localStorage.getItem('poserGray')) $('#poserGray').checked = true;

$('#poserCapture').addEventListener('click', async () => {
  if (!P.root) return B.toast('Cargá un modelo primero', 'err');
  const wasBones = $('#poserShowBones').checked;
  $('#poserShowBones').checked = false;
  const wasGrid = P.grid.visible;
  P.grid.visible = false;
  updateBoneOverlay();
  const dataUrl = captureDataUrl();
  P.grid.visible = wasGrid;
  $('#poserShowBones').checked = wasBones;
  try {
    const { key } = await B.api('/api/upload', { method: 'POST', body: { name: `poser-${P.model.name}.png`, dataUrl } });
    B.addRef(key);
    B.goToCreate();
    B.toast('Captura agregada como referencia');
  } catch (e) {
    B.toast(e.message, 'err');
  }
});

$('#poserSaveScene').addEventListener('click', async () => {
  if (!P.root) return B.toast('Cargá un modelo primero', 'err');
  const name = $('#poserSceneName').value.trim() || `Pose ${new Date().toLocaleString()}`;
  const category = $('#poserSceneCategory').value.trim() || 'General';
  const wasBones = $('#poserShowBones').checked;
  $('#poserShowBones').checked = false;
  const wasGrid = P.grid.visible;
  P.grid.visible = false;
  updateBoneOverlay();
  const thumbDataUrl = captureDataUrl();
  P.grid.visible = wasGrid;
  $('#poserShowBones').checked = wasBones;
  const body = {
    modelId: P.model.id, name, category,
    bones: getPoseData(),
    camera: { position: P.camera.position.toArray(), target: P.controls.target.toArray(), fov: P.camera.fov },
    hidden: P.meshItems.filter((x) => !x.mesh.visible).map((x) => x.mesh.name),
    thumbDataUrl
  };
  const { poses } = await B.api('/api/poser/poses', { method: 'POST', body });
  P.poses = poses;
  $('#poserSceneName').value = '';
  renderSceneList();
  B.toast(`Escena "${name}" guardada`);
});

function renderSceneList() {
  const list = $('#poserSceneList');
  const cats = [...new Set(P.poses.map((x) => x.category || 'General'))].sort((a, b) => a.localeCompare(b));
  $('#poserCategories').innerHTML = cats.map((c) => `<option value="${B.esc(c)}">`).join('');
  if (!P.poses.length) {
    list.innerHTML = '<div class="hint" style="padding:8px">Todavía no guardaste escenas.</div>';
    return;
  }
  list.innerHTML = cats.map((cat) => `
    <div class="poser-scene-cat">${B.esc(cat)}</div>
    ${P.poses.filter((x) => (x.category || 'General') === cat).map((x) => `
      <div class="poser-scene" data-pose="${x.id}">
        ${x.thumbKey ? `<img src="${B.fileUrl(x.thumbKey)}" loading="lazy" alt="">` : ''}
        <div class="poser-scene-info">
          <div class="poser-scene-name">${B.esc(x.name)}</div>
          <div class="poser-scene-model hint">${B.esc(P.models.find((m) => m.id === x.modelId)?.name || 'modelo borrado')}</div>
        </div>
        <div class="poser-scene-actions">
          <button class="mini-btn" data-act="load" title="Aplicar pose y cámara">Cargar</button>
          ${x.thumbKey ? '<button class="mini-btn" data-act="ref" title="Usar como referencia">→ Ref</button>' : ''}
          <button class="icon-btn" data-act="del" title="Borrar">×</button>
        </div>
      </div>`).join('')}`).join('');
  list.querySelectorAll('[data-pose]').forEach((row) => row.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const pose = P.poses.find((x) => x.id === row.dataset.pose);
    if (!pose) return;
    if (btn.dataset.act === 'load') {
      if (pose.modelId !== P.model?.id) {
        const model = P.models.find((m) => m.id === pose.modelId);
        if (!model) return B.toast('El modelo de esta escena ya no existe', 'err');
        $('#poserModelSelect').value = model.id;
        await loadModel(model);
      }
      applyPoseData(pose.bones);
      if (Array.isArray(pose.hidden)) {
        const hiddenSet = new Set(pose.hidden);
        for (const item of P.meshItems) item.mesh.visible = !hiddenSet.has(item.mesh.name);
        renderParts();
      }
      if (pose.camera) {
        P.camera.position.fromArray(pose.camera.position);
        P.controls.target.fromArray(pose.camera.target);
        P.camera.fov = pose.camera.fov || 45;
        P.camera.updateProjectionMatrix();
        $('#poserFov').value = Math.round(P.camera.fov);
        updateFovLabel();
      }
      B.toast(`Escena "${pose.name}" cargada`);
    }
    if (btn.dataset.act === 'ref') {
      B.addRef(pose.thumbKey);
      B.goToCreate();
      B.toast('Pose agregada como referencia');
    }
    if (btn.dataset.act === 'del') {
      if (!confirm(`¿Borrar la escena "${pose.name}"?`)) return;
      const { poses } = await B.api(`/api/poser/poses/${pose.id}`, { method: 'DELETE' });
      P.poses = poses;
      renderSceneList();
    }
  })));
}

// ---------------------------------------------------------------------------
// entrada desde app.js
// ---------------------------------------------------------------------------

window.poserEnter = () => {
  initViewer();
  updateFovLabel();
  refreshPoser().catch((e) => B.toast(e.message, 'err'));
};
