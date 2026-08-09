import Link from "next/link";
import { ArrowsLeftRight, Fire, House, SquaresFour, Storefront } from "@phosphor-icons/react/dist/ssr";
export function MobileNav() { const links = [["/", "首页", House], ["/categories", "分类", SquaresFour], ["/shops", "店铺", Storefront], ["/gateways", "中转", ArrowsLeftRight], ["/projects", "项目", Fire]] as const; return <nav className="mobile-nav" aria-label="移动端导航">{links.map(([href,label,Icon]) => <Link href={href} key={href}><Icon /><span>{label}</span></Link>)}</nav>; }
