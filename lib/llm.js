// Thin wrapper over the Host `llm` service: the plugin reuses the signed-in DeepSeek model.
export class LlmClient {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.routeValue = null;
  }

  service() {
    const llm = this.ctx.get('llm');
    if (!llm) throw new Error('当前 Harness 没有提供模型服务，无法翻译。');
    return llm;
  }

  /** Provider/model resolution: explicit plugin config first, then the session default. */
  route() {
    if (this.routeValue) return this.routeValue;
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.();
    const provider = this.config.provider || selection?.provider;
    const model = this.config.model || selection?.model;
    if (!provider || !model) throw new Error('尚未选择模型，请先在 Harness 中登录 DeepSeek 或选择默认模型。');
    this.routeValue = { provider, model, label: `${model}（${provider}）` };
    return this.routeValue;
  }

  /** Lowest reasoning effort available on this model: translation does not need long thinking. */
  async chooseEffort(signal) {
    if (this.effortResolved) return this.effort;
    this.effortResolved = true;
    try {
      const info = await this.service().resolveModelInfo(this.route().provider, this.route().model, signal);
      const efforts = info?.reasoning?.efforts || [];
      const configured = this.config.reasoningEffort;
      if (configured && efforts.some((effort) => effort.id === configured)) {
        this.effort = configured;
      } else if (efforts.length) {
        const low = efforts.find((effort) => /^(none|off|minimal|low)$/i.test(effort.id) || /最低|低|不思考/.test(effort.name || ''));
        this.effort = low?.id || info?.reasoning?.defaultEffort;
      }
      this.effortLabel = efforts.find((effort) => effort.id === this.effort)?.name;
    } catch {
      this.effort = undefined;
    }
    return this.effort;
  }

  /**
   * One model call, returning the concatenated text.
   * @returns {Promise<{text: string, usage?: object, truncated: boolean}>}
   */
  async complete({ system, prompt, maxTokens, signal, purpose }) {
    const llm = this.service();
    const route = this.route();
    const effort = await this.chooseEffort(signal);
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      ...(effort ? { reasoningEffort: effort } : {}),
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      ...(maxTokens ? { maxTokens } : {}),
      ...(purpose ? { purpose } : {}),
      signal,
    });
    let text = '';
    let blockText = '';
    let usage;
    let finish;
    for await (const chunk of stream) {
      if (!chunk || typeof chunk !== 'object') continue;
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') blockText += chunk.block.text || '';
      else if (chunk.type === 'usage') usage = chunk.usage;
      else if (chunk.type === 'finish') finish = chunk.reason;
    }
    // Some adapters deliver the whole text in block-end instead of deltas.
    if (!text.trim() && blockText.trim()) text = blockText;
    if (finish?.kind === 'error') throw new Error(finish.failure?.message || '模型调用失败。');
    if (finish?.kind === 'aborted') throw Object.assign(new Error('翻译已取消。'), { name: 'AbortError' });
    return { text, usage, truncated: finish?.kind === 'max-tokens' };
  }
}
