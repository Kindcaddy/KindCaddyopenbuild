interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Adds the hover lift used by interactive cards. */
  interactive?: boolean;
}

export default function Card({
  children,
  className = "",
  interactive = false,
}: CardProps) {
  return (
    <div className={`${interactive ? "kc-surface" : "kc-panel"} ${className}`}>
      {children}
    </div>
  );
}
