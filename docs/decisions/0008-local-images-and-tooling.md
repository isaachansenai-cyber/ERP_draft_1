# 0008 Local stack and test tooling

- **Images.** In the development container `public.ecr.aws` was blocked. The Supabase CLI works with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`, which pulls the same images from Docker Hub. This is documented in the README. No project setting depends on it.
- **CLI and Postgres.** The Supabase CLI resolved to v3 and the local Postgres to 17. That is compatible with the "Postgres 15+" requirement.
- **Vitest.** Vitest 3 is used for its `projects` support (unit, integration-pilot, integration-demo). Files run serially because the integration suites share one local database.
- **Imports.** Import and demo scripts use a direct Postgres connection (`DATABASE_URL`), not the REST API, because they run as operator tooling. Only `create-demo-users.ts` needs the service-role key, for the Auth admin API, and only against an allowlisted demo project.
