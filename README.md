# admin page

Dashboard to manage the SSB site. Authentication now uses Stanford SSO with
the shared first-party session used by `web`.

## Local auth

Set the same `SESSION_SECRET` and `SESSION_COOKIE_NAME` as `web`.
Leave `SESSION_COOKIE_DOMAIN` unset on localhost so the cookie is shared across
`localhost:3000` and `localhost:3001`.

Stanford SPDB should allow the local admin service provider metadata and callback:

```
http://localhost:3001/api/auth/metadata
http://localhost:3001/api/auth/callback
```

## Local admin role

```
docker exec -it supabase_db_ssb-local psql -U postgres -c "INSERT INTO public.roles (email, roles) VALUES ('test@stanford.edu', 'admin');"
```
