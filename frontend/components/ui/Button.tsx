import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  block?: boolean;
}

const VARIANTS: Record<string, string> = {
  primary: "kc-btn-primary",
  secondary: "kc-btn-secondary",
  outline: "kc-btn-secondary",
  ghost: "kc-btn-ghost",
  danger: "kc-btn-danger",
};

export default function Button({
  variant = "primary",
  size = "md",
  block = false,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const classes = [
    "kc-btn",
    VARIANTS[variant],
    size === "sm" && "kc-btn--sm",
    block && "kc-btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
