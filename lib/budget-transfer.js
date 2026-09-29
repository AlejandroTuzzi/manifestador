import { budgetSettings, budgetError } from '../public/budget-model.js';

export const BUDGET_TRANSFER_LIMIT = 15 * 1024 * 1024;
function imageExtension(buffer) {
  if (!buffer?.length || buffer.length > 10 * 1024 * 1024) throw budgetError('budgetImage');
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw budgetError('budgetImage');
}
export function exportBudgetSettings(settings, header = null) {
  const clean = budgetSettings(settings);
  if (clean.headerImage && !header) throw budgetError('budgetImage');
  const image = clean.headerImage ? { extension: imageExtension(header), base64: header.toString('base64') } : null;
  return { format: 'manifestador-budget-settings', version: 1, settings: { ...clean, headerImage: '' }, header: image };
}
export function importBudgetSettings(archive) {
  if (!archive || archive.format !== 'manifestador-budget-settings' || archive.version !== 1 || !archive.settings || typeof archive.settings !== 'object' || Array.isArray(archive.settings) || !archive.settings.rates || archive.settings.headerImage) throw budgetError('budgetTransfer');
  const settings = budgetSettings(archive.settings);
  let header = null, extension = '';
  if (archive.header != null) {
    const encoded = archive.header.base64;
    if (typeof encoded !== 'string' || encoded.length > 14 * 1024 * 1024 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw budgetError('budgetImage');
    header = Buffer.from(encoded, 'base64');
    extension = imageExtension(header);
    if (extension !== archive.header.extension) throw budgetError('budgetImage');
  }
  return { settings, header, extension };
}
