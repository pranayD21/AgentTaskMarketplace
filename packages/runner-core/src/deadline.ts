/** Some wasi:http fetch implementations ignore AbortSignal. Race the operation too. */
export async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, code = "TASK_TIMEOUT"): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(code)); controller.abort(); }, timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
