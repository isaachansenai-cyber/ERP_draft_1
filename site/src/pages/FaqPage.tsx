import { PageHeader } from '../components/ui';
import { faqs } from '../content/site';

export function FaqPage() {
  return (
    <>
      <PageHeader eyebrow="FAQ" title="Questions and answers" />
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
        <ul className="flex flex-col gap-3">
          {faqs.map((faq) => (
            <li key={faq.question}>
              <details className="group rounded-xl border border-charcoal/15 bg-cream">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-3 text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ultramarine">
                  {faq.question}
                  <span
                    aria-hidden="true"
                    className="text-2xl text-brick group-open:rotate-45 motion-safe:transition-transform"
                  >
                    +
                  </span>
                </summary>
                <p className="px-5 pb-4">{faq.answer}</p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
