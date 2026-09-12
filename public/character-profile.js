/* Read-only character sheet, shared by Characters, Projects and Series. */
function openCharacterProfile(id) {
  const character = state.characters.find((item) => item.id === id && contentIsVisible(item));
  if (!character) return;
  $('#characterProfileTitle').textContent = character.name;
  const photoButton = (key) => `<button type="button" class="profile-photo" data-profile-photo="${esc(key)}"><img src="${fileUrl(key)}" alt="" loading="lazy"></button>`;
  const field = (label, value) => value ? `<div><strong>${esc(tr(label))}</strong><p class="profile-text">${esc(value)}</p></div>` : '';
  $('#characterProfileBody').innerHTML = `${nsfwBadgeHtml(character)}
    ${field('common.description', character.description)}
    ${field('characters.editor.elevenVoice', character.voiceName || tr('characters.noVoice'))}
    ${field('characters.editor.seedanceAsset', character.arkAssetId)}
    <div class="char-actions"><button type="button" class="mini-btn" id="profilePhotos">${IC('eye')} ${esc(tr('characters.viewPhotos'))}</button><button type="button" class="mini-btn" id="profileAssets">${IC('image')} Assets</button></div>
    <section><h4>${esc(tr('picker.original'))}</h4><div class="profile-photos">${[...new Set(character.photos || [])].map(photoButton).join('')}</div></section>
    ${(character.variants || []).filter(contentIsVisible).map((variant) => `<section class="variant-item">
      <h4>${esc(variant.name)}</h4>${field('common.description', variant.description)}
      ${(variant.photos || []).length ? `<button type="button" class="mini-btn" data-profile-variant="${esc(variant.id)}">${esc(tr('characters.viewPhotos'))} (${variant.photos.length})</button>` : ''}
      ${(variant.distinctiveElements || []).filter(contentIsVisible).length ? `<h4>${esc(tr('distinctive.title'))}</h4><div class="distinctive-list">${(variant.distinctiveElements || []).filter(contentIsVisible).map((element) => `<div class="distinctive-card">${photoButton(element.imageKey)}<div>${nsfwBadgeHtml(element)}<p>${esc(element.text)}</p></div></div>`).join('')}</div>` : ''}
    </section>`).join('')}
    <details class="heygen-character-card"><summary>${esc(tr('characters.editor.heygenVariant'))}</summary>
      ${character.heygen?.imageKey ? photoButton(character.heygen.imageKey) : ''}
      ${field('characters.editor.wideAvatar', heygenWideAvatarId(character))}
      ${field('characters.editor.closeAvatar', character.heygen?.closeAvatarId)}
      ${field('characters.editor.widePrompt', heygenMotionPromptFor(character, 'wide'))}
      ${field('characters.editor.closePrompt', heygenMotionPromptFor(character, 'close'))}
    </details>`;
  const buttons = [...$('#characterProfileBody').querySelectorAll('[data-profile-photo]')];
  const photos = [...new Set(buttons.map((button) => button.dataset.profilePhoto))];
  buttons.forEach((button) => button.addEventListener('click', () => openLightbox(button.dataset.profilePhoto, photos)));
  $('#profilePhotos').addEventListener('click', () => openCharacterGallery(id));
  $('#characterProfileBody').querySelectorAll('[data-profile-variant]').forEach((button) => button.addEventListener('click', () => {
    const keys = [...new Set(character.variants.find((variant) => variant.id === button.dataset.profileVariant)?.photos || [])];
    if (keys.length) openLightbox(keys[0], keys);
  }));
  $('#profileAssets').addEventListener('click', () => openCharacterAssets(id));
  $('#characterProfileModal').hidden = false;
  $('#characterProfileClose').focus();
}
$('#characterProfileClose').addEventListener('click', () => { $('#characterProfileModal').hidden = true; });
$('#characterProfileModal').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); $('#characterProfileClose').click(); }
});
