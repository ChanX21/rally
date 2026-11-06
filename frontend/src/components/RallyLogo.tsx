import Image from "next/image";

const ASPECT_RATIO = 1695 / 980;

export default function RallyLogo({ height = 32 }: { height?: number }) {
  return (
    <Image
      src="/logo/rally-blue-on-cream.svg"
      alt="Rally"
      width={Math.round(height * ASPECT_RATIO)}
      height={height}
      priority
    />
  );
}
