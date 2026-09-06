export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionRequest {
  messages: LLMChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON output when it supports it. */
  jsonMode?: boolean;
}

export interface LLMCompletionResult {
  text: string;
  raw?: unknown;
}

/**
 * The ONLY interface the rest of the codebase is allowed to depend on for
 * talking to an LLM. Concrete providers (GLM-5 via LiteLLM, or any future
 * model) implement this interface. No other module may construct an
 * OpenAI client or hit an LLM endpoint directly -- this keeps "the LLM
 * only produces structured JSON, never executes anything" enforceable at
 * a single choke point.
 */
export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
