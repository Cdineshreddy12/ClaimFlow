import type { ReactNode } from "react";

export function AuthLayout({
  heading,
  subheading,
  children,
}: {
  heading: string;
  subheading?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" />
          <span className="brand-name">Claims Desk</span>
        </div>
        <h1 className="auth-heading">{heading}</h1>
        {subheading ? <p className="auth-subheading">{subheading}</p> : null}
        {children}
      </div>
    </div>
  );
}
