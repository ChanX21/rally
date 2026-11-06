import Image from "next/image";

const ASPECT_RATIO = 1;

export default function RallyLogo({ height = 32 }: { height?: number }) {
  return (
    <Image
      src="/logo/icon-bars-blue-512.png"
      alt="Rally"
      width={Math.round(height * ASPECT_RATIO)}
      height={height}
      priority
    />
  );
}
