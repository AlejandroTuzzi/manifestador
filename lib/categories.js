const PROMPT_RESERVED_CATEGORIES = ['General', 'Estilos', 'LORAS'];

export function categoryKey(value) {
  return String(value || '').trim().toLocaleLowerCase('es');
}

export function sameCategory(left, right) {
  const leftKey = categoryKey(left);
  return Boolean(leftKey) && leftKey === categoryKey(right);
}

export function isReservedPromptCategory(value) {
  return PROMPT_RESERVED_CATEGORIES.some((name) => sameCategory(name, value));
}

export function categoryExists(categories, items, name) {
  const lists = Array.isArray(categories) ? [categories] : Object.values(categories || {});
  return lists.some((list) => (Array.isArray(list) ? list : []).some((category) => sameCategory(category, name)))
    || (Array.isArray(items) ? items : []).some((item) => sameCategory(item?.category, name));
}

function uniqueCategories(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = categoryKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function replaceInList(values, oldName, newName) {
  return uniqueCategories((Array.isArray(values) ? values : []).map((value) => (
    sameCategory(value, oldName) ? newName : value
  )).filter(Boolean));
}

function replaceInItems(items, oldName, newName) {
  let affected = 0;
  const updated = (Array.isArray(items) ? items : []).map((item) => {
    if (!sameCategory(item?.category, oldName)) return item;
    affected += 1;
    return { ...item, category: newName };
  });
  return { items: updated, affected };
}

export function renamePromptCategoryData(promptCategories, prompts, oldName, newName) {
  const categories = Object.fromEntries(Object.entries(promptCategories || {}).map(([mode, values]) => [
    mode,
    replaceInList(values, oldName, newName)
  ]));
  const replaced = replaceInItems(prompts, oldName, newName);
  return { promptCategories: categories, prompts: replaced.items, affected: replaced.affected };
}

export function deletePromptCategoryData(promptCategories, prompts, name) {
  const categories = Object.fromEntries(Object.entries(promptCategories || {}).map(([mode, values]) => [
    mode,
    uniqueCategories((Array.isArray(values) ? values : []).filter((value) => !sameCategory(value, name)))
  ]));
  const replaced = replaceInItems(prompts, name, 'General');
  return { promptCategories: categories, prompts: replaced.items, affected: replaced.affected };
}

export function renameSnippetCategoryData(snippetCategories, snippets, oldName, newName) {
  const replaced = replaceInItems(snippets, oldName, newName);
  return {
    snippetCategories: replaceInList(snippetCategories, oldName, newName),
    snippets: replaced.items,
    affected: replaced.affected
  };
}

export function deleteSnippetCategoryData(snippetCategories, snippets, name) {
  return renameSnippetCategoryData(snippetCategories, snippets, name, '');
}

export function renameVocabularyCategoryData(vocabularyCategories, vocabulary, oldName, newName) {
  const replaced = replaceInItems(vocabulary, oldName, newName);
  return {
    vocabularyCategories: replaceInList(vocabularyCategories, oldName, newName),
    vocabulary: replaced.items,
    affected: replaced.affected
  };
}

export function deleteVocabularyCategoryData(vocabularyCategories, vocabulary, name) {
  const replaced = replaceInItems(vocabulary, name, 'General');
  return {
    vocabularyCategories: uniqueCategories((Array.isArray(vocabularyCategories) ? vocabularyCategories : [])
      .filter((category) => !sameCategory(category, name))),
    vocabulary: replaced.items,
    affected: replaced.affected
  };
}
