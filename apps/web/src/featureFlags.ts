export function isEnabledFeatureFlag(value: string | undefined): boolean {
  return value === "1";
}

export const isTaskModeEnabled = isEnabledFeatureFlag(import.meta.env.FF_TASK_MODE);
