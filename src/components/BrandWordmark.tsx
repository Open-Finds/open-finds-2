import { BRAND } from '../lib/brand';

export function BrandWordmark({ className }: { className: string }) {
  return (
    <span className={className}>
      <img src="/brand/wordmark-light.webp" alt={BRAND.name} width="560" height="368"
        className="block aspect-[560/368] w-full object-contain dark:hidden" />
      <img src="/brand/wordmark-dark.webp" alt={BRAND.name} width="466" height="282"
        className="hidden aspect-[560/368] w-full object-contain dark:block" />
    </span>
  );
}
