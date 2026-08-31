-- 0009: correct which components belong on the notebook surface.
--
-- 0007 seeded a 'text' component for notebooks. That was a mistake: BlockNote
-- already does prose — paragraphs, headings, lists, inline marks — far better
-- than a component wrapping a textarea would, and two ways to write a sentence
-- in the same document is a worse editor, not a richer one.
--
-- The notebook surface is for components the editor does NOT provide: things
-- that carry state, read instruments, or render data. A tally is one. A clock on
-- a written-up experiment is not, and neither is a second kind of paragraph.

delete from widget_types where type = 'text';

update widget_types set surfaces = '{dashboard}'           where type in ('clock', 'notes');
update widget_types set surfaces = '{dashboard,notebook}'  where type = 'counter';
