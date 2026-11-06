// A little running stick figure that actually runs — legs and arms swing out of
// phase with a slight body bob. Inherits color from the surrounding text.

export default function RunningMan({ size = 18 }: { size?: number }) {
  const DUR = "0.6s";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {/* whole body bob */}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0; 0 -0.6; 0 0; 0 -0.6; 0 0" dur={DUR} repeatCount="indefinite" />

        <circle cx="15.5" cy="4.5" r="2" />
        {/* torso: neck -> hip */}
        <path d="M14 7L10.5 12.5" />

        {/* front leg (pivots at hip) */}
        <path d="M10.5 12.5L13 15.5L11.5 19.5">
          <animateTransform attributeName="transform" type="rotate" values="16 10.5 12.5; -18 10.5 12.5; 16 10.5 12.5" dur={DUR} repeatCount="indefinite" />
        </path>
        {/* back leg (pivots at hip, opposite phase) */}
        <path d="M10.5 12.5L8 15.5L5.5 18">
          <animateTransform attributeName="transform" type="rotate" values="-18 10.5 12.5; 16 10.5 12.5; -18 10.5 12.5" dur={DUR} repeatCount="indefinite" />
        </path>

        {/* front arm (pivots at shoulder, opposite its leg) */}
        <path d="M14 7.5L17.5 9">
          <animateTransform attributeName="transform" type="rotate" values="-18 14 7.5; 16 14 7.5; -18 14 7.5" dur={DUR} repeatCount="indefinite" />
        </path>
        {/* back arm (pivots at shoulder, opposite phase) */}
        <path d="M14 7.5L10 9">
          <animateTransform attributeName="transform" type="rotate" values="16 14 7.5; -18 14 7.5; 16 14 7.5" dur={DUR} repeatCount="indefinite" />
        </path>
      </g>
    </svg>
  );
}
