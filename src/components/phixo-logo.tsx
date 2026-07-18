import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Phixo brand logo, matching the pitch deck: orange brain mark +
 * "PHIXO" wordmark in bold Quantico, dark navy (#1E2D4A).
 */
export function PhixoLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.35em] font-bold tracking-tight",
        className
      )}
      style={{ fontFamily: "var(--font-quantico)" }}
    >
      <Image
        src="/phixo-brain.png"
        alt=""
        width={256}
        height={256}
        className="size-[1.15em]"
        priority
      />
      <span className="text-[#1E2D4A] dark:text-[#DAE5F1]">PHIXO</span>
    </span>
  );
}
