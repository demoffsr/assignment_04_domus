-- First content of the study library: the Design Methodology list.
-- Run once:  wrangler d1 execute tubus --file=seed-library.sql   (add --remote for production)
-- The entries belong to the first account created (the site owner).

INSERT INTO lib_subjects (id, name, owner_id, position) SELECT 'a0a0a0a0a0a0a000', 'Design Methodology', id, 1 FROM users ORDER BY created_at, id LIMIT 1;

INSERT INTO lib_sections (id, subject_id, name, owner_id, position) SELECT 'b0b0b0b0b0b0b001', 'a0a0a0a0a0a0a000', 'Books', id, 1 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00101', 'b0b0b0b0b0b0b001', 'Carles Martí Arís – Le variazioni dell’identità', '', NULL, 1, id, 1 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00102', 'b0b0b0b0b0b0b001', 'Bruno Munari – La scoperta del cerchio', 'Part of a trilogy with La scoperta del quadrato and La scoperta del triangolo', NULL, 1, id, 2 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00103', 'b0b0b0b0b0b0b001', 'Alberto Bassi – Design anonimo in Italia. Oggetti comuni e progetto incognito', 'Electa', NULL, 1, id, 3 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00104', 'b0b0b0b0b0b0b001', 'Gianni Rodari – Grammatica della fantasia', '1973', NULL, 1, id, 4 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00105', 'b0b0b0b0b0b0b001', 'Joost Grootens – Metropolitan World Atlas', '2005, 010 Publishers', NULL, 1, id, 5 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00106', 'b0b0b0b0b0b0b001', 'Alice Rawsthorn – Design as an Attitude', '2018, JRP|Ringier', NULL, 1, id, 6 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00107', 'b0b0b0b0b0b0b001', 'John Berger – Ways of Seeing', '1972', 'https://www.ways-of-seeing.com', 1, id, 7 FROM users ORDER BY created_at, id LIMIT 1;

INSERT INTO lib_sections (id, subject_id, name, owner_id, position) SELECT 'b0b0b0b0b0b0b002', 'a0a0a0a0a0a0a000', 'Artists', id, 2 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00201', 'b0b0b0b0b0b0b002', 'Lucio Fontana – Concetto spaziale', 'Series Buchi and Tagli', NULL, 0, id, 1 FROM users ORDER BY created_at, id LIMIT 1;

INSERT INTO lib_sections (id, subject_id, name, owner_id, position) SELECT 'b0b0b0b0b0b0b003', 'a0a0a0a0a0a0a000', 'Designers', id, 3 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00301', 'b0b0b0b0b0b0b003', 'Alessandro Mendini', '', NULL, 0, id, 1 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00302', 'b0b0b0b0b0b0b003', 'Ettore Sottsass', '', NULL, 0, id, 2 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00303', 'b0b0b0b0b0b0b003', 'Mario Bellini', '', NULL, 0, id, 3 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00304', 'b0b0b0b0b0b0b003', 'Ólafur Elíasson', '', NULL, 0, id, 4 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00305', 'b0b0b0b0b0b0b003', 'Anish Kapoor', '', NULL, 0, id, 5 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00306', 'b0b0b0b0b0b0b003', 'Lacaton & Vassal', '', NULL, 0, id, 6 FROM users ORDER BY created_at, id LIMIT 1;

INSERT INTO lib_sections (id, subject_id, name, owner_id, position) SELECT 'b0b0b0b0b0b0b004', 'a0a0a0a0a0a0a000', 'Movements', id, 4 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00401', 'b0b0b0b0b0b0b004', 'Memphis Design', '', NULL, 0, id, 1 FROM users ORDER BY created_at, id LIMIT 1;

INSERT INTO lib_sections (id, subject_id, name, owner_id, position) SELECT 'b0b0b0b0b0b0b005', 'a0a0a0a0a0a0a000', 'Brands', id, 5 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00501', 'b0b0b0b0b0b0b005', 'Edra', '', NULL, 0, id, 1 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00502', 'b0b0b0b0b0b0b005', 'Olivetti', '', NULL, 0, id, 2 FROM users ORDER BY created_at, id LIMIT 1;

INSERT INTO lib_sections (id, subject_id, name, owner_id, position) SELECT 'b0b0b0b0b0b0b006', 'a0a0a0a0a0a0a000', 'Objects', id, 6 FROM users ORDER BY created_at, id LIMIT 1;
INSERT INTO lib_items (id, section_id, title, note, url, planned, owner_id, position) SELECT 'c0c0c0c0c0c00601', 'b0b0b0b0b0b0b006', 'Olivetti Valentine', 'Sottsass, 1969', NULL, 0, id, 1 FROM users ORDER BY created_at, id LIMIT 1;
