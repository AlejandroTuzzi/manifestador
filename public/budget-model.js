export const BUDGET_GROUPS = ['episodes', 'characters', 'locations', 'objects', 'script', 'voices', 'music'];
export const budgetError = (code, status = 400) => Object.assign(new Error(code), { localizationCode: code, status });
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const number = (value, min = 0, max = 10000000, integer = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw budgetError('budgetNumber');
  return value;
};
export function defaultBudgetSettings() {
  return { usdPerEuro: null, headerImage: '', footerHtml: '', rates: {
    episodes: { pilot: 0, regular: 0, revisions: 2 },
    characters: { provided: 0, create: 0, revisions: 2 },
    locations: { price: 0, revisions: 2 }, objects: { price: 0, revisions: 2 },
    script: { provided: 0, create: 0, unit: 'fixed', revisions: 2 },
    voices: { provided: 0, create: 0, unit: 'character', revisions: 2 },
    music: { provided: 0, create: 0, unit: 'fixed', revisions: 2 }
  } };
}
export function budgetSettings(body = {}) {
  const defaults = defaultBudgetSettings();
  const out = { ...defaults, usdPerEuro: body.usdPerEuro == null ? null : number(body.usdPerEuro, 0.000001, 10000), headerImage: text(body.headerImage, 500), footerHtml: text(body.footerHtml, 12000), rates: {} };
  if (out.headerImage && (!/^(uploads|generated)\/[\w ./-]+\.(png|jpe?g|webp)$/i.test(out.headerImage) || out.headerImage.includes('..'))) throw budgetError('budgetImage');
  for (const group of BUDGET_GROUPS) {
    const base = defaults.rates[group], values = body.rates?.[group] || base;
    out.rates[group] = {};
    for (const [key, fallback] of Object.entries(base)) {
      const value = values[key] ?? fallback;
      if (key === 'unit') {
        if (group === 'voices') { out.rates[group][key] = 'character'; continue; }
        if (!['fixed', 'minute', 'episode'].includes(value)) throw budgetError('budgetNumber');
        out.rates[group][key] = value;
      } else out.rates[group][key] = number(value, 0, key === 'revisions' ? 100 : 1000000, key === 'revisions');
    }
  }
  return out;
}
export function newBudgetDraft() {
  return { product: 'vertical-drama', client: '', title: '', description: '', deadline: '', currency: 'USD',
    pilotMinutes: 2, episodeMinutes: 2, episodes: [{}, {}], characters: [], locations: [], objects: [],
    script: 'provided', voices: 'provided', music: 'provided', discounts: Object.fromEntries(BUDGET_GROUPS.map(group => [group, 0])) };
}
export function saveBudget(body, settings, previous = null, { id, now = Date.now() } = {}) {
  if (previous && ['paid', 'cancelled'].includes(previous.status)) throw budgetError('budgetArchived', 409);
  if (previous && body.revision !== previous.revision) throw budgetError('budgetConflict', 409);
  const out = { id: previous?.id || id, product: 'vertical-drama', status: previous?.status || 'draft',
    client: text(body.client), title: text(body.title), description: text(body.description, 10000), deadline: text(body.deadline, 10),
    currency: previous?.currency || body.currency, createdAt: previous?.createdAt ?? now, updatedAt: now, revision: (previous?.revision || 0) + 1,
    pilotMinutes: number(body.pilotMinutes, 0.01, 1440), episodeMinutes: number(body.episodeMinutes, 0.01, 1440) };
  if (!out.client || !out.title) throw budgetError('budgetRequired');
  if (!['USD', 'EUR'].includes(out.currency)) throw budgetError('budgetCurrency');
  if (out.deadline) {
    const date = new Date(out.deadline + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.deadline) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== out.deadline) throw budgetError('budgetDeadline');
  }
  if (!Array.isArray(body.episodes) || body.episodes.length < 1 || body.episodes.length > 500) throw budgetError('budgetEpisodes');
  out.episodes = body.episodes.map((_, index) => ({ number: index + 1, pilot: index === 0, final: index === body.episodes.length - 1 }));
  for (const group of ['characters', 'locations', 'objects']) {
    if (!Array.isArray(body[group]) || body[group].length > 200) throw budgetError('budgetNumber');
    out[group] = body[group].map(item => {
      if (!item || !text(item.name)) throw budgetError('budgetElementName');
      if (group === 'characters') return { name: text(item.name), sex: text(item.sex, 100), species: text(item.species, 100), age: text(item.age, 100), source: item.source === 'provided' ? 'provided' : 'create' };
      if (group === 'locations') return { name: text(item.name), type: text(item.type, 200), lighting: text(item.lighting, 1000) };
      return { name: text(item.name), characteristics: text(item.characteristics, 1000) };
    });
  }
  for (const group of ['script', 'voices', 'music']) {
    if (!['provided', 'create'].includes(body[group])) throw budgetError('budgetNumber');
    out[group] = body[group];
  }
  out.discounts = {};
  for (const group of BUDGET_GROUPS) out.discounts[group] = number(body.discounts?.[group] ?? 0, 0, 100);
  out.snapshot = previous?.snapshot || budgetSettings(settings);
  if (out.currency === 'EUR' && !out.snapshot.usdPerEuro) throw budgetError('budgetEuroRate');
  out.totals = calculateBudget(out);
  return out;
}
export function calculateBudget(quote) {
  const rates = quote.snapshot.rates;
  const minutes = quote.pilotMinutes + Math.max(0, quote.episodes.length - 1) * quote.episodeMinutes;
  const base = {
    episodes: quote.pilotMinutes * rates.episodes.pilot + Math.max(0, quote.episodes.length - 1) * quote.episodeMinutes * rates.episodes.regular,
    characters: quote.characters.reduce((sum, item) => sum + rates.characters[item.source], 0),
    locations: quote.locations.length * rates.locations.price,
    objects: quote.objects.length * rates.objects.price
  };
  for (const group of ['script', 'voices', 'music']) base[group] = rates[group][quote[group]] * (group === 'voices' && rates[group].unit === 'character' ? quote.characters.length : rates[group].unit === 'minute' ? minutes : rates[group].unit === 'episode' ? quote.episodes.length : 1);
  const fx = quote.currency === 'EUR' ? quote.snapshot.usdPerEuro : 1;
  const groups = BUDGET_GROUPS.map(group => {
    const baseUsdCents = Math.round(base[group] * 100);
    const discountUsdCents = Math.round(baseUsdCents * quote.discounts[group] / 100);
    const totalUsdCents = baseUsdCents - discountUsdCents;
    const baseCents = Math.round(baseUsdCents / fx), totalCents = Math.round(totalUsdCents / fx);
    return { group, baseUsdCents, discountUsdCents, totalUsdCents, baseCents, discountCents: baseCents - totalCents, totalCents };
  });
  const totalUsdCents = groups.reduce((sum, row) => sum + row.totalUsdCents, 0);
  const totalCents = groups.reduce((sum, row) => sum + row.totalCents, 0);
  if (![totalUsdCents, totalCents].every(Number.isSafeInteger)) throw budgetError('budgetNumber');
  return { minutes, groups, totalUsdCents, totalCents };
}
export function setBudgetStatus(previous, status, revision, now = Date.now()) {
  if (!previous) throw budgetError('budgetNotFound', 404);
  if (revision !== previous.revision) throw budgetError('budgetConflict', 409);
  const allowed = { draft: ['sent', 'cancelled'], sent: ['paid', 'cancelled'], paid: [], cancelled: [] };
  if (!allowed[previous.status]?.includes(status)) throw budgetError('budgetStatus', 409);
  return { ...previous, status, updatedAt: now, revision: previous.revision + 1, [status + 'At']: now };
}
export function budgetEarnings(quotes) {
  const result = { active: { count: 0, usdCents: 0 }, potential: { count: 0, usdCents: 0 }, earned: { count: 0, usdCents: 0 } };
  for (const quote of quotes) {
    const group = { draft: 'potential', sent: 'active', paid: 'earned' }[quote.status];
    if (group) { result[group].count++; result[group].usdCents += quote.totals.totalUsdCents; }
  }
  return result;
}
