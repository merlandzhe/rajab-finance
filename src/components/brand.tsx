import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
export function Brand({ light = false, href = "/" }: { light?: boolean; href?: string }) {
  return <Link className={"brand " + (light ? "brand-light" : "")} href={href} aria-label="HESAP — на главную">
    <span className="brand-mark"><BookOpenCheck size={30} strokeWidth={1.6} aria-hidden="true" /></span>
    <span>HESAP</span>
  </Link>;
}
