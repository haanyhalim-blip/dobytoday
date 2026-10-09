-- DobyToday – photos on cards (e.g. a weekend away, for the family to see)
-- Run once: Supabase → SQL Editor → New query → paste this whole file → Run. Safe to run again.
--
-- In plain English: this makes a storage box for card photos. Only someone signed in can add a photo.
-- Each photo gets a long random name, so it can only be found through the card it's on – the same as the card itself,
-- which anyone with its share link can open. Photos only (JPEG, PNG, WebP), up to 5 MB each.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dobytoday-photos', 'dobytoday-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dobytoday photos: signed-in people add" on storage.objects;
create policy "dobytoday photos: signed-in people add" on storage.objects for insert to authenticated
  with check (bucket_id = 'dobytoday-photos');

-- Check it worked: you should see one row, dobytoday-photos.
select id, public, file_size_limit from storage.buckets where id = 'dobytoday-photos';
