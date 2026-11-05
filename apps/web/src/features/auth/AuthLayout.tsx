import type { ReactNode } from "react";
import { BrandMark, BrandName } from "@/components/ui/brand";

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
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-[400px] flex-col gap-1">
        <div className="mb-[22px] flex items-center justify-center gap-2">
          <BrandMark />
          <BrandName />
        </div>
        <h1 className="mb-1 text-center text-xl font-semibold tracking-[-0.01em]">
          {heading}
        </h1>
        {subheading ? (
          <p className="mb-6 text-center text-base text-ink-faint">
            {subheading}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
