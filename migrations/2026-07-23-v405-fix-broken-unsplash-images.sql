-- v405 — Fix broken Unsplash hero images that black-screened the home page
-- and a flash-deal viewer (ss2 Udaipur black hero; ss3 intermittent home
-- black screen). Two Unsplash photo ids 404 (were removed from Unsplash):
--   photo-1524229073600-8c1d1a4d0f3f  (Udaipur hotel hero + rail avatar)
--   photo-1580889240912-c39ecf3fef47
-- Replace them in-place across hotels.images and rooms.images (both text[])
-- with two valid, verified-200 Unsplash hotel photos. array_replace is
-- idempotent — a second run finds nothing to replace.
--
-- Additive / forward-only. No schema change. Verified 0 broken remaining.

UPDATE hotels
SET images = array_replace(
               array_replace(
                 images,
                 'https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format',
                 'https://images.unsplash.com/photo-1587922546307-776227941871?w=1200&auto=format'
               ),
               'https://images.unsplash.com/photo-1580889240912-c39ecf3fef47?w=1200&auto=format',
               'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&auto=format'
             )
WHERE images && ARRAY[
        'https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format',
        'https://images.unsplash.com/photo-1580889240912-c39ecf3fef47?w=1200&auto=format'
      ]::text[];

UPDATE rooms
SET images = array_replace(
               array_replace(
                 images,
                 'https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format',
                 'https://images.unsplash.com/photo-1587922546307-776227941871?w=1200&auto=format'
               ),
               'https://images.unsplash.com/photo-1580889240912-c39ecf3fef47?w=1200&auto=format',
               'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&auto=format'
             )
WHERE images && ARRAY[
        'https://images.unsplash.com/photo-1524229073600-8c1d1a4d0f3f?w=1200&auto=format',
        'https://images.unsplash.com/photo-1580889240912-c39ecf3fef47?w=1200&auto=format'
      ]::text[];
