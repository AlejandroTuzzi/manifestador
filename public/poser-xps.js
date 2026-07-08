// ---------------------------------------------------------------------------
// Parser de modelos XNALara / XPS (XNALara Posing Studio).
// Soporta .mesh.ascii (texto), .mesh / .xps (binario con o sin cabecera).
// Módulo puro sin dependencias: devuelve datos crudos que poser.js convierte
// en objetos de Three.js. También se puede importar desde Node para tests.
// ---------------------------------------------------------------------------

// Resultado: { bones: [{ name, parent, position:[x,y,z] }], meshes: [...] }
// Cada mesh: { name, renderGroup, specular, textures:[{ file, uvLayer }],
//   positions, normals, colors, uvs, skinIndices, skinWeights, indices }

export function parseXps(arrayBuffer, filename = '') {
  const bytes = new Uint8Array(arrayBuffer);
  const looksAscii = /\.ascii$/i.test(filename)
    || (bytes.length > 4 && bytes[0] !== 0x20 && isProbablyText(bytes));
  return looksAscii ? parseAscii(new TextDecoder('utf-8').decode(bytes)) : parseBinary(arrayBuffer);
}

function isProbablyText(bytes) {
  for (let i = 0; i < Math.min(64, bytes.length); i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b > 126) return false;
  }
  return true;
}

// El nombre del mesh codifica el render group y el brillo: "5_Cuerpo_0.5".
function parseMeshName(raw) {
  const m = /^(\d+)_(.+?)(?:_([\d.]+))?(?:_.*)?$/.exec(raw);
  return {
    name: m ? m[2] : raw,
    renderGroup: m ? Number(m[1]) : 0,
    specular: m && m[3] !== undefined ? Number(m[3]) : 0.1
  };
}

// ---------------------------------------------------------------------------
// Formato ASCII (.mesh.ascii)
// ---------------------------------------------------------------------------

function parseAscii(text) {
  const lines = text.split(/\r?\n/);
  let li = 0;
  const nextLine = () => {
    while (li < lines.length && lines[li].trim() === '') li++;
    if (li >= lines.length) throw new Error('El archivo .mesh.ascii terminó antes de lo esperado.');
    return lines[li++].trim();
  };
  const nums = (line) => line.split(/[\s,]+/).filter(Boolean).map(Number);
  const int = () => {
    const v = nums(nextLine())[0];
    if (!Number.isInteger(v) || v < 0) throw new Error('Se esperaba un entero en el .mesh.ascii.');
    return v;
  };

  const boneCount = int();
  if (boneCount > 10000) throw new Error('El archivo no parece un .mesh.ascii válido.');
  const bones = [];
  for (let i = 0; i < boneCount; i++) {
    const name = nextLine();
    const parent = nums(nextLine())[0];
    const position = nums(nextLine()).slice(0, 3);
    bones.push({ name, parent, position });
  }

  const meshCount = int();
  const meshes = [];
  for (let m = 0; m < meshCount; m++) {
    const head = parseMeshName(nextLine());
    const uvLayers = Math.max(1, int());
    const texCount = int();
    const textures = [];
    for (let t = 0; t < texCount; t++) {
      const file = nextLine();
      const uvLayer = int();
      textures.push({ file: baseName(file), uvLayer });
    }
    const vertexCount = int();

    // Los .mesh.ascii viejos incluyen una línea de tangente por capa UV;
    // los de XPS moderno no. Probamos ambas hipótesis y validamos contra
    // la línea de cantidad de caras.
    const vStart = li;
    const hasBones = boneCount > 0;
    const tryLayout = (withTangents) => {
      const perVertex = 3 + uvLayers * (withTangents ? 2 : 1) + (hasBones ? 2 : 0);
      const faceLine = vStart + vertexCount * perVertex;
      // saltar líneas vacías no es viable acá: exigimos formato compacto
      if (faceLine >= lines.length) return null;
      const fc = nums(lines[faceLine].trim());
      if (fc.length !== 1 || !Number.isInteger(fc[0]) || fc[0] < 0) return null;
      if (faceLine + 1 + fc[0] > lines.length) return null;
      if (fc[0] > 0) {
        const probe = nums(lines[faceLine + 1].trim());
        if (probe.length !== 3 || probe.some((v) => !Number.isInteger(v) || v < 0 || v >= vertexCount)) return null;
      }
      return { perVertex, faceLine, faceCount: fc[0], withTangents };
    };
    const layout = tryLayout(false) || tryLayout(true);
    if (!layout) throw new Error(`No pude interpretar los vértices del mesh "${head.name}".`);

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    const uvs = new Float32Array(vertexCount * 2);
    const skinIndices = hasBones ? new Uint16Array(vertexCount * 4) : null;
    const skinWeights = hasBones ? new Float32Array(vertexCount * 4) : null;

    for (let v = 0; v < vertexCount; v++) {
      let cursor = vStart + v * layout.perVertex;
      const pos = nums(lines[cursor++].trim());
      const nor = nums(lines[cursor++].trim());
      const col = nums(lines[cursor++].trim());
      const uv0 = nums(lines[cursor++].trim());
      cursor += (uvLayers - 1) * (layout.withTangents ? 1 : 0) + (uvLayers - 1);
      if (layout.withTangents) cursor += 1; // tangente de la capa 0 (más las de arriba)
      positions.set(pos.slice(0, 3), v * 3);
      normals.set(nor.slice(0, 3), v * 3);
      colors.set([col[0] / 255, col[1] / 255, col[2] / 255, (col[3] ?? 255) / 255], v * 4);
      uvs.set([uv0[0], uv0[1]], v * 2);
      if (hasBones) {
        const bi = nums(lines[cursor++].trim());
        const bw = nums(lines[cursor++].trim());
        skinIndices.set(bi.slice(0, 4), v * 4);
        skinWeights.set(bw.slice(0, 4), v * 4);
      }
    }

    const indices = new Uint32Array(layout.faceCount * 3);
    for (let f = 0; f < layout.faceCount; f++) {
      const tri = nums(lines[layout.faceLine + 1 + f].trim());
      indices.set(tri.slice(0, 3), f * 3);
    }
    li = layout.faceLine + 1 + layout.faceCount;

    meshes.push({ ...head, textures, positions, normals, colors, uvs, skinIndices, skinWeights, indices });
  }
  return { bones, meshes };
}

// ---------------------------------------------------------------------------
// Formato binario (.mesh / .xps)
// ---------------------------------------------------------------------------

class Reader {
  constructor(arrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.bytes = new Uint8Array(arrayBuffer);
    this.pos = 0;
  }
  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  skip(n) { this.pos += n; }
  // string de .NET BinaryWriter: longitud varint de 7 bits + UTF-8
  str() {
    let len = 0, shift = 0, b;
    do { b = this.u8(); len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const out = new TextDecoder('utf-8').decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return out;
  }
}

const XPS_MAGIC = 323232;

function parseBinary(arrayBuffer) {
  const r = new Reader(arrayBuffer);
  let hasTangents = true; // el .mesh original de XNALara (sin cabecera) las incluye
  if (r.view.byteLength >= 4 && r.view.getUint32(0, true) === XPS_MAGIC) {
    r.u32(); // magic
    const verMajor = r.u16();
    r.u16(); // verMinor
    r.str(); // "XNAaraL"
    const settingsLen = r.u32();
    r.str(); r.str(); r.str(); // máquina, usuario, archivos
    r.skip(settingsLen * 4);
    hasTangents = verMajor <= 1;
  }

  const boneCount = r.u32();
  if (boneCount > 10000) throw new Error('No pude leer este binario. Probá exportarlo como .mesh.ascii desde XPS.');
  const bones = [];
  for (let i = 0; i < boneCount; i++) {
    const name = r.str();
    const parent = r.i16();
    const position = [r.f32(), r.f32(), r.f32()];
    bones.push({ name, parent, position });
  }

  const meshCount = r.u32();
  if (meshCount > 10000) throw new Error('No pude leer este binario. Probá exportarlo como .mesh.ascii desde XPS.');
  const meshes = [];
  const hasBones = boneCount > 0;
  for (let m = 0; m < meshCount; m++) {
    const head = parseMeshName(r.str());
    const uvLayers = Math.max(1, r.u32());
    const texCount = r.u32();
    const textures = [];
    for (let t = 0; t < texCount; t++) {
      const file = r.str();
      const uvLayer = r.u32();
      textures.push({ file: baseName(file), uvLayer });
    }
    const vertexCount = r.u32();
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    const uvs = new Float32Array(vertexCount * 2);
    const skinIndices = hasBones ? new Uint16Array(vertexCount * 4) : null;
    const skinWeights = hasBones ? new Float32Array(vertexCount * 4) : null;

    for (let v = 0; v < vertexCount; v++) {
      positions.set([r.f32(), r.f32(), r.f32()], v * 3);
      normals.set([r.f32(), r.f32(), r.f32()], v * 3);
      colors.set([r.u8() / 255, r.u8() / 255, r.u8() / 255, r.u8() / 255], v * 4);
      for (let l = 0; l < uvLayers; l++) {
        const u = r.f32(), vv = r.f32();
        if (l === 0) uvs.set([u, vv], v * 2);
      }
      if (hasTangents) r.skip(uvLayers * 16);
      if (hasBones) {
        skinIndices.set([r.u16(), r.u16(), r.u16(), r.u16()], v * 4);
        skinWeights.set([r.f32(), r.f32(), r.f32(), r.f32()], v * 4);
      }
    }
    const faceCount = r.u32();
    const indices = new Uint32Array(faceCount * 3);
    for (let f = 0; f < faceCount * 3; f++) indices[f] = r.u32();
    meshes.push({ ...head, textures, positions, normals, colors, uvs, skinIndices, skinWeights, indices });
  }
  return { bones, meshes };
}

// ---------------------------------------------------------------------------
// Archivos .pose de XNALara: "nombre de hueso: rotX rotY rotZ [posX posY posZ [escala]]"
// Las rotaciones están en grados.
// ---------------------------------------------------------------------------

export function parsePoseFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const sep = line.lastIndexOf(':');
    if (sep === -1) continue;
    const name = line.slice(0, sep).trim();
    const vals = line.slice(sep + 1).trim().split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
    if (!name || vals.length < 3) continue;
    out[name] = { rot: vals.slice(0, 3), pos: vals.length >= 6 ? vals.slice(3, 6) : [0, 0, 0] };
  }
  return out;
}

export function serializePose(bones) {
  return Object.entries(bones)
    .map(([name, b]) => `${name}: ${b.rot.map((v) => round3(v)).join(' ')} ${(b.pos || [0, 0, 0]).map((v) => round3(v)).join(' ')} 1 1 1`)
    .join('\n');
}

function round3(v) { return Math.round(v * 1000) / 1000; }

function baseName(file) {
  return String(file).replace(/\\/g, '/').split('/').pop().trim();
}
