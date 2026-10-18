declare module "wasi:config/store@0.2.0-rc.1" {
  /** Returns the value or undefined; throws on store errors. */
  export function get(key: string): string | undefined;
}
