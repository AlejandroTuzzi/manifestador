import { CAMERA_GROUPS, buildCameraPrompt } from './camera-model.js';

const cameraDialog = document.getElementById('cameraDialog');
const cameraButton = document.getElementById('btnCamera');
const cameraSelection = {};
let cameraMode = 'image';

function updateCameraPreview() {
  const prefix = buildCameraPrompt(cameraSelection, cameraMode);
  document.getElementById('cameraPreview').value = prefix ? prefix + ', ' : '';
  document.getElementById('cameraInsert').disabled = !prefix;
}
function renderCameraFields() {
  const fields = document.getElementById('cameraFields');
  fields.replaceChildren();
  for (const group of CAMERA_GROUPS) {
    if (group.videoOnly && cameraMode !== 'video') continue;
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = tr(`camera.group.${group.id}`);
    const select = document.createElement('select');
    select.className = 'select'; select.dataset.cameraGroup = group.id;
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = tr('camera.none'); select.append(blank);
    for (const option of group.options) {
      const node = document.createElement('option'); node.value = option.id;
      node.textContent = tr(`camera.option.${group.id}.${option.id}`); select.append(node);
    }
    select.value = cameraSelection[group.id] || '';
    select.addEventListener('change', () => { cameraSelection[group.id] = select.value; updateCameraPreview(); });
    label.append(title, select); fields.append(label);
  }
  updateCameraPreview();
}
cameraButton.addEventListener('click', () => {
  if (!['image', 'video', 'comfyui'].includes(state.mode)) return;
  cameraMode = state.mode;
  renderCameraFields(); cameraDialog.showModal();
  document.querySelector('#cameraFields select')?.focus();
});
document.getElementById('cameraClose').addEventListener('click', () => cameraDialog.close());
cameraDialog.addEventListener('click', event => {
  if (event.target !== cameraDialog) return;
  const rect = cameraDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cameraDialog.close();
});
document.getElementById('cameraReset').addEventListener('click', () => {
  for (const key of Object.keys(cameraSelection)) delete cameraSelection[key];
  renderCameraFields();
});
document.getElementById('cameraForm').addEventListener('submit', event => {
  event.preventDefault();
  if (state.mode !== cameraMode) { cameraDialog.close(); return; }
  const prefix = buildCameraPrompt(cameraSelection, cameraMode);
  if (!prefix) return;
  const box = document.getElementById('promptBox');
  // Insert, never replace the current selection or the existing prompt.
  box.setRangeText(prefix + ', ', 0, 0, 'end');
  box.dispatchEvent(new Event('input', {bubbles:true}));
  cameraDialog.close(); box.focus();
});
window.addEventListener('manifestador:localechange', () => { if (cameraDialog.open) renderCameraFields(); });
