/**
 * LLM layer entry point. Picks a provider based on environment:
 *   - OPENAI_API_KEY set  -> OpenAILLMProvider (can also point at a local llama.cpp/Ollama server)
 *   - otherwise           -> MockLLMProvider
 */

import { MockLLMProvider } from './mock';
import { OpenAILLMProvider } from './openai';
import type { LLMProvider } from './types';

let cached: LLMProvider | null = null;

export function getLLM(): LLMProvider {
  if (cached) return cached;
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    cached = new OpenAILLMProvider({
      apiKey: key,
      baseUrl: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL,
    });
  } else {
    cached = new MockLLMProvider();
  }
  return cached;
}

export * from './types';
export { MockLLMProvider } from './mock';
export { OpenAILLMProvider } from './openai';
