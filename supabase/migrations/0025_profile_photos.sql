-- ---------------------------------------------------------------------------
-- 0025: profile photos.
--
-- One nullable column on `profiles` for the storage path of the member's
-- photo, and a PRIVATE storage bucket to hold it.
--
-- PRIVATE ON PURPOSE. This is a health app and a face is personal data. The
-- bucket is not public and has no storage policies, so nothing can read or
-- write it except the server with the service role. The app never stores a
-- URL: it stores the object path, and the API hands out a short-lived signed
-- link each time the profile is loaded.
--
-- The bucket enforces what the upload route also checks: images only, at
-- most 1 MB. The app shrinks photos to a 512px square on the phone before
-- upload, so a real one is a fraction of that.
--
-- Safe to run before or after the code merges: the code tolerates the column
-- and bucket being absent (uploads answer "not switched on yet"). Run it
-- first anyway, per the migration-first rule.
--
-- Idempotent: `if not exists` on the column, upsert on the bucket.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
