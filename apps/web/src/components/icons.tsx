import { Check, File, Logout, X } from "reicon-react";

export function CheckIcon({ size = 11 }: { size?: number }) {
  return <Check size={size} />;
}

export function CrossIcon({ size = 11 }: { size?: number }) {
  return <X size={size} />;
}

export function FileIcon({ size = 14 }: { size?: number }) {
  return <File size={size} />;
}

export function SignOutIcon({ size = 14 }: { size?: number }) {
  return <Logout size={size} />;
}
