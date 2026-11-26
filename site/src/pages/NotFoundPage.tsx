import { LinkButton, PageHeader } from '../components/ui';

export function NotFoundPage() {
  return (
    <>
      <PageHeader eyebrow="Page not found" title="This page took a wrong turn" />
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
        <LinkButton to="/">Back to the home page</LinkButton>
      </div>
    </>
  );
}
