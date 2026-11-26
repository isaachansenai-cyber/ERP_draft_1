import { LiveMenu } from '../components/LiveMenu';
import { PageHeader } from '../components/ui';
import { locations } from '../content/site';

export function MenuPage() {
  return (
    <>
      <PageHeader
        eyebrow="Order for pickup"
        title="Menu"
        intro={`Five dishes from five countries, ready for pickup in ${locations.join(', ')}.`}
      />
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <LiveMenu variant="full" />
      </div>
    </>
  );
}
