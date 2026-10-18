import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const gb = (bytes: number | null | undefined) => `${(Number(bytes || 0) / 1024 ** 3).toFixed(1)} GB`;
export const cents = (value: number | null | undefined) =>
  value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
export const microusd = (value: number | null | undefined) =>
  value == null ? null : `$${(value / 1e6).toFixed(3)}`;
export const clock = (iso: string | undefined) =>
  iso && Number.isFinite(Date.parse(iso))
    ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
export const shortId = (id: string | null | undefined, keep = 8) =>
  !id ? "" : id.length <= keep * 2 + 1 ? id : `${id.slice(0, keep)}…${id.slice(-4)}`;
