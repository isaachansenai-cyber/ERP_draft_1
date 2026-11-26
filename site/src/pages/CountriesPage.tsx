import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Photo } from '../components/Photo';
import { SplitSection } from '../components/SplitSection';
import { Eyebrow, PageHeader, TextLink } from '../components/ui';
import { countries, findCountry } from '../content/countries';

export function CountriesPage() {
  const [params] = useSearchParams();
  const selected = findCountry(params.get('c'));

  // Home-page tiles link here with ?c=<country>; hash routing rules out #anchors.
  useEffect(() => {
    if (selected) document.getElementById(selected.id)?.scrollIntoView({ block: 'start' });
  }, [selected]);

  return (
    <>
      <PageHeader
        eyebrow="Our countries"
        title="Five kitchens, five stories"
        intro="Every dish on our menu is our take on a tradition we admire. Here is where each one comes from."
      />
      {countries.map((c, i) => (
        <SplitSection
          key={c.id}
          id={c.id}
          labelledBy={`${c.id}-heading`}
          reverse={i % 2 === 1}
          tone={i % 2 === 0 ? 'paper' : 'cream'}
          art={<Photo photo={c.photo} sizes="(min-width: 768px) 50vw, 100vw" />}
        >
          <Eyebrow>{c.name}</Eyebrow>
          <h2 id={`${c.id}-heading`} className="font-display text-3xl font-bold">
            {c.dishName}
          </h2>
          {c.paragraphs.map((p) => (
            <p key={p.slice(0, 24)} className="text-lg">
              {p}
            </p>
          ))}
          <p className="font-semibold">{c.prepNote}</p>
          <p>
            <TextLink to="/menu">See it on the menu</TextLink>
          </p>
        </SplitSection>
      ))}
    </>
  );
}
