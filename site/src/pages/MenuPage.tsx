import { DishCard } from '../components/DishCard';
import { PlaceholderArt } from '../components/PlaceholderArt';
import { Notice, PageHeader } from '../components/ui';
import { countries } from '../content/countries';
import { hours, locations, ORDERING_OPEN, sauces } from '../content/site';

export function MenuPage() {
  return (
    <>
      <PageHeader
        eyebrow="Order for pickup"
        title="Menu"
        intro={`Five dishes from five countries, ready for pickup in ${locations.join(', ')}.`}
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:px-8">
        {!ORDERING_OPEN ? (
          <Notice title="Online ordering opens soon">
            When it opens you will choose a pickup location here and see live prices, availability and pickup times.
            Until then, visit us: {hours.label.toLowerCase()}.
          </Notice>
        ) : null}

        <section aria-labelledby="dishes">
          <h2 id="dishes" className="font-display text-3xl font-bold">
            Dishes
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {countries.map((c) => (
              <DishCard key={c.id} country={c} />
            ))}
          </div>
        </section>

        <section aria-labelledby="sauces" className="grid overflow-hidden rounded-xl bg-cream md:grid-cols-2">
          <div className="min-h-[220px]">
            <PlaceholderArt tone={{ base: 'flame', accent: 'cream' }} subject="our bottled sauces" />
          </div>
          <div className="flex flex-col justify-center gap-3 p-6">
            <h2 id="sauces" className="font-display text-3xl font-bold">
              {sauces.heading}
            </h2>
            <p className="text-lg">{sauces.body}</p>
          </div>
        </section>
      </div>
    </>
  );
}
