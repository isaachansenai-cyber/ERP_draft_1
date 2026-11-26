import { Link } from 'react-router-dom';
import { DishCard } from '../components/DishCard';
import { Hero } from '../components/Hero';
import { PlaceholderArt } from '../components/PlaceholderArt';
import { SplitSection } from '../components/SplitSection';
import { Eyebrow, LinkButton, Notice, TextLink } from '../components/ui';
import { countries } from '../content/countries';
import { closingCta, countriesTeaser, ORDERING_OPEN, pickupSteps, storyTeaser } from '../content/site';

export function HomePage() {
  return (
    <>
      <Hero />

      <SplitSection
        labelledBy="story-teaser"
        art={<PlaceholderArt tone={{ base: 'brick', accent: 'saffron' }} subject="our kitchen and team" />}
      >
        <Eyebrow>Our story</Eyebrow>
        <h2 id="story-teaser" className="font-display text-3xl font-bold">
          {storyTeaser.heading}
        </h2>
        <p className="text-lg">{storyTeaser.body}</p>
        <p>
          <TextLink to="/story">Read our story</TextLink>
        </p>
      </SplitSection>

      <section aria-labelledby="countries-teaser" className="bg-cream px-4 py-14 md:px-8">
        <div className="mx-auto max-w-6xl">
          <Eyebrow>Our countries</Eyebrow>
          <h2 id="countries-teaser" className="mt-2 font-display text-3xl font-bold">
            {countriesTeaser.heading}
          </h2>
          <p className="mt-2 max-w-2xl text-lg">{countriesTeaser.body}</p>
          <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-5">
            {countries.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/countries?c=${c.id}`}
                  className="group block overflow-hidden rounded-xl bg-charcoal text-cream focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine"
                >
                  <div className="aspect-square">
                    <PlaceholderArt tone={c.tone} subject={`${c.dishName} from ${c.name}`} />
                  </div>
                  <p className="px-3 py-2 font-display text-lg font-bold group-hover:underline">{c.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="menu-preview" className="bg-paper px-4 py-14 md:px-8">
        <div className="mx-auto max-w-6xl">
          <Eyebrow>Menu</Eyebrow>
          <h2 id="menu-preview" className="mt-2 font-display text-3xl font-bold">
            Our dishes
          </h2>
          {!ORDERING_OPEN ? (
            <div className="mt-4">
              <Notice title="Online ordering opens soon">
                Prices, availability and pickup times will appear here when ordering opens.
              </Notice>
            </div>
          ) : null}
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {countries.map((c) => (
              <DishCard key={c.id} country={c} />
            ))}
          </div>
          <p className="mt-8">
            <LinkButton to="/menu">See the full menu</LinkButton>
          </p>
        </div>
      </section>

      <SplitSection
        reverse
        tone="cream"
        labelledBy="how-pickup"
        art={<PlaceholderArt tone={{ base: 'ultramarine', accent: 'saffron' }} subject="the pickup counter" />}
      >
        <Eyebrow>Pickup only</Eyebrow>
        <h2 id="how-pickup" className="font-display text-3xl font-bold">
          How pickup works
        </h2>
        <ol className="flex flex-col gap-4">
          {pickupSteps.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brick font-bold text-paper"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="font-bold">{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </SplitSection>

      <section aria-labelledby="closing-cta" className="bg-charcoal px-4 py-16 text-center text-cream md:px-8">
        <h2 id="closing-cta" className="font-display text-3xl font-bold">
          {closingCta.heading}
        </h2>
        <p className="mt-3 text-lg">{closingCta.body}</p>
        <p className="mt-6">
          <LinkButton to="/menu" variant="light">
            Order for pickup
          </LinkButton>
        </p>
      </section>
    </>
  );
}
