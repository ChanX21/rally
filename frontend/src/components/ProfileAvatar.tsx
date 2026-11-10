export const AVATARS = ["orbit", "sun", "sprout", "spark", "wave", "moon"] as const;

export function ProfileAvatar({ avatar, size = 64 }: { avatar: string; size?: number }) {
  const blue = "#315FE8", orange = "#EC562E";
  return <svg width={size} height={size} viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <circle cx="40" cy="40" r="39" fill="#FFF5EF" stroke="#E7D9CF" />
    {avatar === "sun" ? <><path d="M40 10v8m0 44v8M10 40h8m44 0h8M19 19l6 6m30 30 6 6M19 61l6-6m30-30 6-6" stroke={orange} strokeWidth="4" strokeLinecap="round"/><circle cx="40" cy="40" r="20" fill={orange}/></>
      : avatar === "sprout" ? <><path d="M40 57V34" stroke={blue} strokeWidth="4"/><path d="M40 38C17 39 16 20 18 18c18 0 24 9 22 20Z" fill={orange}/><path d="M40 34c-2-18 12-22 24-18 0 17-10 23-24 18Z" fill={blue}/><path d="M23 46h34l-5 20H28Z" fill={blue}/></>
      : avatar === "spark" ? <path d="m40 10 8 18 20 2-14 15 3 22-17-11-17 11 3-22-14-15 20-2Z" fill={orange}/>
      : avatar === "wave" ? <path d="M13 51c9-34 24-37 35-27 8 7 2 17 15 16l5 21H13Z" fill={blue}/>
      : avatar === "moon" ? <><path d="M55 15a27 27 0 1 0 12 39A27 27 0 0 1 55 15Z" fill={blue}/><circle cx="62" cy="22" r="3" fill={orange}/></>
      : <><circle cx="40" cy="40" r="22" fill={blue}/><ellipse cx="40" cy="40" rx="33" ry="10" transform="rotate(-30 40 40)" stroke={orange} strokeWidth="4"/></>}
    <g transform={avatar === "sprout" ? "translate(0 12)" : undefined} stroke={avatar === "sun" || avatar === "spark" ? "#1C1917" : "#FFF5EF"} strokeWidth="2.5" strokeLinecap="round">
      <path d="M33 39v2m12-2v2M34 47q6 5 12 0"/>
    </g>
  </svg>;
}
