/* Motor i18n de Manifestador. Los catálogos viven en public/locales/*.js. */
(function initManifestadorI18n(global) {
  const catalogs = Object.create(null);
  const supportedLocales = ['es', 'en'];
  let currentLocale = 'es';
  let errorMatchers = null;

  function normalizeLocale(value) {
    const locale = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return supportedLocales.includes(locale) ? locale : 'es';
  }

  function register(locale, messages) {
    const normalized = normalizeLocale(locale);
    catalogs[normalized] = { ...(catalogs[normalized] || {}), ...(messages || {}) };
    errorMatchers = null;
  }

  function interpolate(value, variables = {}) {
    return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
      variables[name] === undefined || variables[name] === null ? match : String(variables[name])
    ));
  }

  function translate(key, variables = {}, fallback) {
    const value = catalogs[currentLocale]?.[key] ?? catalogs.es?.[key] ?? fallback ?? key;
    return interpolate(value, variables);
  }

  function plural(key, count, variables = {}, fallback) {
    const category = new Intl.PluralRules(localeTag()).select(Number(count));
    const suffix = category === 'one' ? 'one' : 'other';
    return translate(`${key}.${suffix}`, { ...variables, count }, fallback);
  }

  function has(key, locale = currentLocale) {
    return Object.prototype.hasOwnProperty.call(catalogs[normalizeLocale(locale)] || {}, key);
  }

  // También reconoce mensajes antiguos guardados en el historial o recibidos sin
  // código. Sólo se aplica a errores, nunca a prompts ni contenido del usuario.
  function errorMessage(payload, fallback = '') {
    const code = payload?.code || payload?.localizationCode;
    if (code && has(`errors.${code}`)) {
      return translate(`errors.${code}`, payload.details || payload.localizationDetails || {});
    }
    const message = typeof payload === 'string' ? payload : payload?.error || payload?.message || fallback;
    if (typeof message !== 'string') return fallback;
    if (!errorMatchers) {
      errorMatchers = { exact: new Map(), templates: [] };
      for (const catalog of Object.values(catalogs)) {
        for (const [key, template] of Object.entries(catalog)) {
          if (!key.startsWith('errors.')) continue;
          const names = [];
          let end = 0;
          let pattern = '^';
          const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          for (const match of template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
            pattern += escape(template.slice(end, match.index)) + '([\\s\\S]*?)';
            names.push(match[1]);
            end = match.index + match[0].length;
          }
          if (!names.length) errorMatchers.exact.set(template, key);
          else errorMatchers.templates.push({ key, names, pattern: new RegExp(pattern + escape(template.slice(end)) + '$') });
        }
      }
    }
    const exact = errorMatchers.exact.get(message);
    if (exact) return translate(exact);
    for (const { key, names, pattern } of errorMatchers.templates) {
      const match = pattern.exec(message);
      if (match) return translate(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
    }
    // Los diagnósticos desconocidos del SO o proveedor se conservan íntegros.
    return message;
  }

  function translateElement(element) {
    const textKey = element.dataset.i18n;
    if (textKey) element.textContent = translate(textKey, {}, element.textContent);
    for (const attribute of ['title', 'placeholder', 'ariaLabel']) {
      const datasetKey = `i18n${attribute[0].toUpperCase()}${attribute.slice(1)}`;
      const key = element.dataset[datasetKey];
      if (!key) continue;
      const htmlAttribute = attribute === 'ariaLabel' ? 'aria-label' : attribute;
      element.setAttribute(htmlAttribute, translate(key, {}, element.getAttribute(htmlAttribute) || ''));
    }
  }

  function apply(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]')
      .forEach(translateElement);
    if (has('app.title')) document.title = translate('app.title');
    document.documentElement.lang = currentLocale;
  }

  function setLocale(locale, { persist = true, applyNow = true } = {}) {
    currentLocale = normalizeLocale(locale);
    if (persist) {
      try { global.localStorage?.setItem('manifestadorLanguage', currentLocale); } catch { /* almacenamiento no disponible */ }
    }
    if (applyNow) apply(document);
    global.dispatchEvent?.(new CustomEvent('manifestador:localechange', { detail: { locale: currentLocale } }));
    return currentLocale;
  }

  function localeTag(locale = currentLocale) {
    return normalizeLocale(locale) === 'en' ? 'en-US' : 'es-AR';
  }

  function formatNumber(value, options = {}) {
    return new Intl.NumberFormat(localeTag(), options).format(value);
  }

  function formatDate(value, options = {}) {
    return new Intl.DateTimeFormat(localeTag(), options).format(new Date(value));
  }

  function catalogReport() {
    const allKeys = [...new Set(Object.values(catalogs).flatMap((catalog) => Object.keys(catalog)))].sort();
    return Object.fromEntries(supportedLocales.map((locale) => [locale, allKeys.filter((key) => !has(key, locale))]));
  }

  global.ManifestadorI18n = {
    register,
    translate,
    t: translate,
    plural,
    has,
    errorMessage,
    apply,
    setLocale,
    getLocale: () => currentLocale,
    normalizeLocale,
    localeTag,
    formatNumber,
    formatDate,
    catalogReport,
    supportedLocales: [...supportedLocales]
  };
})(window);
