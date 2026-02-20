# admin page

dashboard to manage ssb site without having to dig into supabase

##
docker exec -it supabase_db_ssb-local psql -U postgres -c "INSERT INTO public.roles (email, roles) VALUES ('test@stanford.edu', 'admin');"
