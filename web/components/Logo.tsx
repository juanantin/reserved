import Image from "next/image";

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/images/reserved_logo.png"
      alt="Reserved"
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}
