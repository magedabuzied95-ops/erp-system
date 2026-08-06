import type { CopilotInput } from "./CopilotTypes";

const freeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

export class CopilotContext {
  readonly input: Readonly<CopilotInput>;

  constructor(input: CopilotInput) {
    this.input = freeze(structuredClone(input));
  }

  get analysis() { return this.input.analysis; }
  get conversation() { return this.input.conversation; }
  get customer() { return this.input.customer; }
  get currentAgent() { return this.input.currentAgent; }
  get permissions() { return this.input.permissions; }
}

