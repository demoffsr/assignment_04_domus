-- Free-text credit line for co-authored books ("Dmitrii Demidov, Derin Arayici").
-- When NULL the owner's display name is shown.
ALTER TABLE books ADD COLUMN credit TEXT;
