/** Prefer no thinking when supported; never infer support from the model name. */
export function modelThinkingControl(metadata: any): false | string | undefined {
  const values = metadata?.thinking?.values;
  if (Array.isArray(values)) {
    if (values.includes(false)) return false;
    return values.includes('low')?'low':values.find((value: unknown) => typeof value === 'string');
  }
  return Array.isArray(metadata?.capabilities)&&metadata.capabilities.includes('thinking') ? false : undefined;
}
