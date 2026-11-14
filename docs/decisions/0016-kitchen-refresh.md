# 0016 Kitchen queue refresh by polling

CLAUDE.md §2 allows Realtime only to trigger refetches; it never replaces durable state. Milestone 2 refetches the kitchen queue every 10 seconds (and after every action) instead of subscribing to Realtime. That keeps the local stack and RLS surface smaller while meeting "never replace durable database state". A Realtime subscription can be added later as a refetch trigger without changing the data path.
