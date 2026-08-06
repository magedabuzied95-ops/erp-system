import type { PluginContext } from "./PluginContext";

export type PluginCategory = "CRM" | "Conversation" | "Decision" | "Automation" | "Analytics" | "Reporting" | (string & {});
export type PluginExecutionMode = "Sequential" | "Parallel" | "Conditional";
export interface PluginDependency { id: string; version?: string; optional?: boolean; }
export type PluginPatch = Readonly<Record<string, unknown>>;
export interface PluginExecutionResult { patch: PluginPatch; confidence?: number; cacheKey?: string; }
export interface PluginErrorContext { pluginId: string; error: Error; context: PluginContext; }

export interface AIPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly category: PluginCategory;
  readonly dependencies: readonly PluginDependency[];
  readonly executionMode: PluginExecutionMode;
  enabled: boolean;
  shouldExecute?(context: PluginContext): boolean | Promise<boolean>;
  execute(context: PluginContext): PluginExecutionResult | Promise<PluginExecutionResult>;
  onRegister?(context: PluginContext): void | Promise<void>;
  onExecute?(context: PluginContext): void | Promise<void>;
  onSuccess?(result: PluginExecutionResult, context: PluginContext): void | Promise<void>;
  onError?(details: PluginErrorContext): void | Promise<void>;
  onDispose?(context: PluginContext): void | Promise<void>;
}

export interface PluginTelemetry {
  pluginId: string;
  version: string;
  executionTime: number;
  cacheHit: boolean;
  status: "completed" | "failed" | "skipped";
  error?: string;
}

export type PluginProvider = () => readonly AIPlugin[] | Promise<readonly AIPlugin[]>;

