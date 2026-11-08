import { BRAND, brandAssets } from '../lib/brand';
import { cn } from '../lib/utils';
export function BrandLogo({ size = 32, withName = true, className }: { size?: number; withName?: boolean; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-2', withName && 'brand-lockup', className)} aria-hidden={!withName || undefined}>
    {withName && brandAssets.wordmark ? <img src={brandAssets.wordmark} height={brandAssets.wordmarkHeight} style={{ height: brandAssets.wordmarkHeight }} className="brand-wordmark object-contain" alt={BRAND.name} /> : <>
      <img src={size <= 40 ? brandAssets.smallMark : brandAssets.mark} width={size} height={size} className="shrink-0 object-contain" alt="" />
      {withName && <span className="text-subheading tracking-tight text-foreground">{BRAND.name}</span>}
    </>}
  </span>;
}
