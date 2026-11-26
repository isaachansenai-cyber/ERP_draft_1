import { Photo } from '../components/Photo';
import { SplitSection } from '../components/SplitSection';
import { PageHeader } from '../components/ui';
import { mission, story } from '../content/site';

export function StoryPage() {
  return (
    <>
      <PageHeader eyebrow="Our story" title="A world of welcome" />
      {story.map((section, i) => (
        <SplitSection
          key={section.heading}
          labelledBy={`story-${i}`}
          reverse={i % 2 === 1}
          tone={i % 2 === 0 ? 'paper' : 'cream'}
          art={<Photo photo={section.photo} sizes="(min-width: 768px) 50vw, 100vw" />}
        >
          <h2 id={`story-${i}`} className="font-display text-3xl font-bold">
            {section.heading}
          </h2>
          {section.paragraphs.map((p) => (
            <p key={p.slice(0, 24)} className="text-lg">
              {p}
            </p>
          ))}
        </SplitSection>
      ))}
      <section aria-labelledby="mission" className="bg-charcoal px-4 py-16 text-cream md:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-saffron">Our mission</p>
          <h2 id="mission" className="mt-2 font-display text-3xl font-bold">
            {mission.heading}
          </h2>
          <ul className="mt-8 grid gap-6 md:grid-cols-3">
            {mission.points.map((point) => (
              <li key={point.title} className="rounded-xl border border-cream/25 p-5">
                <h3 className="font-display text-2xl font-bold text-saffron">{point.title}</h3>
                <p className="mt-2">{point.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
