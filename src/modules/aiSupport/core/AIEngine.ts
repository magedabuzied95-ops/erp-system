import type { AIContext } from "./AIContext";

export interface AIEngine<T = unknown> {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  execute(context: AIContext): T | Promise<T>;
}

export const ENGINE_VERSION = "1.0.0";

