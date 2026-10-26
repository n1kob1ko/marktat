/** Dekoratives Höhenlinien-Muster (Alpen-Anmutung) für dunkle Flächen. */
export function TopoPattern({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 800 400" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.2">
        <path d="M-20 330c90-40 160-120 260-130s170 60 260 30 140-120 320-110" />
        <path d="M-20 300c90-40 170-130 270-140s160 50 250 20 150-130 320-120" />
        <path d="M-20 270c100-50 180-140 280-150s150 40 240 10 160-140 320-130" />
        <path d="M-20 240c110-60 190-150 290-160s140 30 230 0 170-150 320-140" />
        <path d="M-20 210c120-70 200-160 300-170s130 20 220-10 180-160 320-150" />
        <path d="M60 190c80-60 140-120 220-126s110 20 180-6 150-120 240-110" />
        <path d="M150 168c60-44 100-84 160-88s80 14 130-4 110-80 160-74" />
        <path d="M250 150c40-28 70-52 104-54s56 10 90-2 70-50 100-46" />
      </g>
    </svg>
  );
}
