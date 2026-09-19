(function (root) {
  const names = { wan: 'Wan', gemini: 'Nano Banana', openai: 'GPT Image', seedream: 'Seedream', qwen: 'Qwen', wavespeed: 'FireRed', seedance: 'Seedance', minimax: 'MiniMax', omni: 'Gemini Omni', heygen: 'HeyGen', elevenlabs: 'ElevenLabs', suno: 'Suno' };
  const priority = { 'gpt-image-2.5-sunburst': 250, 'gpt-image-2.5-flare': 250, 'gpt-image-2': 200, 'nano-banana-2': 310, 'nano-banana-2-lite': 310, 'nano-banana-pro': 300 };
  function rank(model) {
    if (priority[model.id] != null) return priority[model.id];
    if (model.provider === 'heygen') return /Avatar V\b/.test(model.name) ? 500 : /Avatar IV\b/.test(model.name) ? 400 : /Avatar III\b/.test(model.name) ? 300 : 0;
    const numbers = model.name.match(/\d+/g) || [];
    return Number(numbers[0] || 0) * 100 + Number(numbers[1] || 0);
  }
  root.ManifestadorModelFamilies = function (models) {
    const groups = new Map();
    for (const model of models) {
      const family = model.family || names[model.provider] || model.provider || model.name;
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push(model);
    }
    return [...groups].map(([name, models]) => ({ name, models: [...models].sort((a, b) => rank(b) - rank(a)) }));
  };
})(globalThis);
