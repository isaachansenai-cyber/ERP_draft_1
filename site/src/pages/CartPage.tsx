import { LinkButton, Notice, PageHeader } from '../components/ui';
import { hours, ORDERING_OPEN } from '../content/site';

/** W1: there is no cart yet. W3 adds it, W4 adds checkout (BUILD_PLAN §8). */
export function CartPage() {
  return (
    <>
      <PageHeader eyebrow="Pickup order" title="Your cart" />
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 md:px-8">
        <p className="text-lg">Your cart is empty.</p>
        {!ORDERING_OPEN ? (
          <Notice title="Online ordering opens soon">
            Nothing can be ordered on this site yet, and no order has been placed. Until it opens, visit us:{' '}
            {hours.label.toLowerCase()}.
          </Notice>
        ) : null}
        <p>
          <LinkButton to="/menu">Browse the menu</LinkButton>
        </p>
      </div>
    </>
  );
}
