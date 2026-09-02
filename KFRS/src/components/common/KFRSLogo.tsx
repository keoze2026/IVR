import { cn } from "../../utils";

interface KFRSLogoProps {
  className?: string;
  variant?: "default" | "white";
}

export function KFRSLogo({ className, variant = "default" }: KFRSLogoProps) {
  const isWhite = variant === "white";
  
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* SVG Emblem */}
      <svg
        width="48"
        height="48"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0 drop-shadow-md"
      >
        {/* Background Shield/Rings */}
        <circle cx="50" cy="50" r="45" fill={isWhite ? "white" : "#006600"} opacity="0.1" />
        <circle cx="50" cy="50" r="40" stroke={isWhite ? "white" : "#006600"} strokeWidth="4" />
        
        {/* Skate Icon / Streak */}
        <path
          d="M30 65 L45 40 L60 40 L70 55 L75 55 L75 65 Z"
          fill={isWhite ? "white" : "#BB0000"}
        />
        {/* Wheels */}
        <circle cx="38" cy="72" r="4" fill={isWhite ? "#E5E5E5" : "#0C0A09"} />
        <circle cx="50" cy="72" r="4" fill={isWhite ? "#E5E5E5" : "#0C0A09"} />
        <circle cx="62" cy="72" r="4" fill={isWhite ? "#E5E5E5" : "#0C0A09"} />
        
        {/* Speed Streaks */}
        <path d="M20 50 L40 50" stroke={isWhite ? "white" : "#EAB308"} strokeWidth="3" strokeLinecap="round" />
        <path d="M25 40 L45 40" stroke={isWhite ? "white" : "#EAB308"} strokeWidth="3" strokeLinecap="round" />
      </svg>
      
      {/* Text Mark */}
      <div className="flex flex-col justify-center">
        <span className={cn(
          "font-bold text-xl leading-tight tracking-tight",
          isWhite ? "text-white" : "text-kenya-black"
        )}>
          KFRS
        </span>
        <span className={cn(
          "text-[10px] font-semibold uppercase tracking-wider",
          isWhite ? "text-white/80" : "text-kenya-red"
        )}>
          Skating for Life
        </span>
      </div>
    </div>
  );
}
