import OpenAI from 'openai';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';
import { LLMClient, LLMCompletionRequest, LLMCompletionResult } from './llm.client';

/**
 * GLM-5, accessed exclusively through LiteLLM's OpenAI-compatible API.
 * The API key is read once from env and never logged, printed, or
 * included in any error payload returned to a caller.
 */
export class Glm5Client implements LLMClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxRetries: number;

  constructor() {
    if (!env.litellmBaseUrl) {
      logger.warn({ msg: 'LITELLM_BASE_URL is not configured; LLM calls will fail until set.' });
    }
    this.client = new OpenAI({
      apiKey: env.litellmApiKey || 'unset',
      baseURL: env.litellmBaseUrl || undefined,
      timeout: env.llmRequestTimeoutMs
    });
    this.model = env.llmModel;
    this.maxRetries = env.llmMaxRetries;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 2000,
          ...(request.jsonMode ? { response_format: { type: 'json_object' as const } } : {})
        });

        const text = response.choices[0]?.message?.content ?? '';
        logger.info({
          operation: 'llm.complete',
          model: this.model,
          attempt,
          durationMs: Date.now() - startedAt,
          status: 'ok'
        });
        return { text, raw: response };
      } catch (err) {
        lastError = err;
        logger.error({
          operation: 'llm.complete',
          model: this.model,
          attempt,
          durationMs: Date.now() - startedAt,
          status: 'error',
          // Never log err.headers/config -- those can carry auth details.
          message: err instanceof Error ? err.message : 'unknown error'
        });
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
    }

    throw AppError.badGateway(
      'LLM_UNAVAILABLE',
      'LiteLLM/GLM-5 did not respond successfully after retries',
      { message: lastError instanceof Error ? lastError.message : String(lastError) }
    );
  }
}
