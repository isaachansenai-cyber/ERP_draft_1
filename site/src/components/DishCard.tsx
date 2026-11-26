import type { Country } from '../content/countries';
import { ALLERGEN_PENDING } from '../content/site';
import { Photo } from './Photo';

/**
 * Menu card. Until W3 connects the ERP it shows no price or availability:
 * those only ever come from the server (BUILD_PLAN §5.2).
 */
export function DishCard({ country, headingLevel = 'h3' }: { country: Country; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel;
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-charcoal/15 bg-paper shadow-sm">
      <div className="aspect-[4/3]">
        <Photo photo={country.photo} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm font-bold uppercase tracking-wider text-brick">{country.name}</p>
        <Heading className="font-display text-xl font-bold">{country.dishName}</Heading>
        <p>{country.summary}</p>
        <p className="text-sm font-semibold">{country.prepNote}</p>
        <p className="mt-auto text-sm text-muted">{ALLERGEN_PENDING}</p>
      </div>
    </article>
  );
}
