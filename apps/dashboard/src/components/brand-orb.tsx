import { Orb } from "./ui/thinking-orbs";

/** Shared animated mark for the landing page and workspace. */
export function BrandOrb({ className }: { className?: string }) {
  return <Orb state="working" size={32} speed={.45} density={1.4} dotSize={.65} className={className} />;
}
