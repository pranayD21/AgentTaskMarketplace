/** Wassette (Wasmtime) sandbox runtime. Implemented in the sandbox phase; until then it is absent. */
export const WassetteRuntime: (new (role: "seller" | "judge", judgePrivateKeyB64?: string) => import("./types.js").Runtime) | null = null;
