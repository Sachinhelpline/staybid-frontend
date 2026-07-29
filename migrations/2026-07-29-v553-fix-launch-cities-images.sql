-- v553 — fix launch-cities images (v551 used dead Unsplash URLs → wrong/cheese images).
-- Replace hotels/rooms/circle_properties/circle_room_types/b2b_listings images with
-- working Pexels URLs (same sets the known-good hco-seed hotels use), theme-matched,
-- card image rotated so same-theme hotels differ. Data-only, additive UPDATE.

-- hco-seed-hdw (river)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/18871098/pexels-photo-18871098.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/5205097/pexels-photo-5205097.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/38044214/pexels-photo-38044214.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/36123978/pexels-photo-36123978.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999497/pexels-photo-28999497.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/3848879/pexels-photo-3848879.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-hdw';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/8818741/pexels-photo-8818741.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-hdw-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/9345636/pexels-photo-9345636.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-hdw-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/18871098/pexels-photo-18871098.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-hdw')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/8818741/pexels-photo-8818741.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-hdw-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/9345636/pexels-photo-9345636.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-hdw-r2')::uuid;

-- hco-seed-vns (river)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/5205097/pexels-photo-5205097.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/38044214/pexels-photo-38044214.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/36123978/pexels-photo-36123978.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999497/pexels-photo-28999497.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/3848879/pexels-photo-3848879.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/18871098/pexels-photo-18871098.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-vns';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/8818741/pexels-photo-8818741.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-vns-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/9345636/pexels-photo-9345636.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-vns-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/5205097/pexels-photo-5205097.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-vns')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/8818741/pexels-photo-8818741.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-vns-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/9345636/pexels-photo-9345636.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-vns-r2')::uuid;

-- hco-seed-bhi (lake)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/36824861/pexels-photo-36824861.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/32690108/pexels-photo-32690108.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/8055260/pexels-photo-8055260.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/34792746/pexels-photo-34792746.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/12284845/pexels-photo-12284845.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/12387869/pexels-photo-12387869.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-bhi';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-bhi-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/35587816/pexels-photo-35587816.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-bhi-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/36824861/pexels-photo-36824861.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-bhi')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-bhi-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/35587816/pexels-photo-35587816.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-bhi-r2')::uuid;

-- hco-seed-muk (hill)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/16172055/pexels-photo-16172055.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/13727745/pexels-photo-13727745.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/29494184/pexels-photo-29494184.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/36721869/pexels-photo-36721869.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/19689227/pexels-photo-19689227.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999498/pexels-photo-28999498.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-muk';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-muk-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-muk-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/16172055/pexels-photo-16172055.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-muk')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-muk-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-muk-r2')::uuid;

-- hco-seed-ksl (hill)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/13727745/pexels-photo-13727745.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/29494184/pexels-photo-29494184.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/36721869/pexels-photo-36721869.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/19689227/pexels-photo-19689227.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999498/pexels-photo-28999498.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/16172055/pexels-photo-16172055.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-ksl';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-ksl-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-ksl-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/13727745/pexels-photo-13727745.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-ksl')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-ksl-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-ksl-r2')::uuid;

-- hco-seed-chl (hill)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/29494184/pexels-photo-29494184.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/36721869/pexels-photo-36721869.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/19689227/pexels-photo-19689227.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999498/pexels-photo-28999498.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/16172055/pexels-photo-16172055.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/13727745/pexels-photo-13727745.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-chl';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-chl-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-chl-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/29494184/pexels-photo-29494184.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-chl')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-chl-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-chl-r2')::uuid;

-- hco-seed-dhr (hill)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/36721869/pexels-photo-36721869.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/19689227/pexels-photo-19689227.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999498/pexels-photo-28999498.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/16172055/pexels-photo-16172055.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/13727745/pexels-photo-13727745.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/29494184/pexels-photo-29494184.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-dhr';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-dhr-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-dhr-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/36721869/pexels-photo-36721869.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-dhr')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-dhr-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-dhr-r2')::uuid;

-- hco-seed-bir (hill)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/19689227/pexels-photo-19689227.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/28999498/pexels-photo-28999498.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/16172055/pexels-photo-16172055.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/13727745/pexels-photo-13727745.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/29494184/pexels-photo-29494184.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/36721869/pexels-photo-36721869.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-bir';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-bir-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-bir-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/19689227/pexels-photo-19689227.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-bir')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-bir-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/15124016/pexels-photo-15124016.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-bir-r2')::uuid;

-- hco-seed-nmr (fort)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/19160108/pexels-photo-19160108.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/19160079/pexels-photo-19160079.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/35130760/pexels-photo-35130760.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/19438328/pexels-photo-19438328.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/29530551/pexels-photo-29530551.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/14020336/pexels-photo-14020336.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-nmr';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/9345636/pexels-photo-9345636.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-nmr-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/4307823/pexels-photo-4307823.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-nmr-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/19160108/pexels-photo-19160108.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-nmr')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/9345636/pexels-photo-9345636.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-nmr-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/4307823/pexels-photo-4307823.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-nmr-r2')::uuid;

-- hco-seed-mth (heritage)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/34669530/pexels-photo-34669530.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/1719173/pexels-photo-1719173.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/7195782/pexels-photo-7195782.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/27960113/pexels-photo-27960113.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/12688960/pexels-photo-12688960.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/262047/pexels-photo-262047.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-mth';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/17657612/pexels-photo-17657612.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-mth-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-mth-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/34669530/pexels-photo-34669530.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-mth')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/17657612/pexels-photo-17657612.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-mth-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-mth-r2')::uuid;

-- hco-seed-vrn (heritage)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/1719173/pexels-photo-1719173.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/7195782/pexels-photo-7195782.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/27960113/pexels-photo-27960113.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/12688960/pexels-photo-12688960.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/262047/pexels-photo-262047.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/34669530/pexels-photo-34669530.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-vrn';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/17657612/pexels-photo-17657612.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-vrn-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-vrn-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/1719173/pexels-photo-1719173.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-vrn')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/17657612/pexels-photo-17657612.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-vrn-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-vrn-r2')::uuid;

-- hco-seed-ayo (heritage)
UPDATE public.hotels SET images = '{"https://images.pexels.com/photos/7195782/pexels-photo-7195782.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/27960113/pexels-photo-27960113.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/12688960/pexels-photo-12688960.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/262047/pexels-photo-262047.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/34669530/pexels-photo-34669530.jpeg?auto=compress&cs=tinysrgb&w=1200","https://images.pexels.com/photos/1719173/pexels-photo-1719173.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-ayo';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/17657612/pexels-photo-17657612.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-ayo-r1';
UPDATE public.rooms SET images = '{"https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"}'::text[] WHERE id = 'hco-seed-ayo-r2';
UPDATE public.circle_properties SET images = '["https://images.pexels.com/photos/7195782/pexels-photo-7195782.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('cp-hco-seed-ayo')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/17657612/pexels-photo-17657612.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-ayo-r1')::uuid;
UPDATE public.circle_room_types SET images = '["https://images.pexels.com/photos/38147801/pexels-photo-38147801.jpeg?auto=compress&cs=tinysrgb&w=1200"]'::jsonb WHERE id = md5('crt-hco-seed-ayo-r2')::uuid;

-- Model 2 (b2b_listings) — refresh embedded images from the corrected hotels/rooms
UPDATE b2b_listings b
SET metadata = b.metadata
  || jsonb_build_object('prop_images', to_jsonb(h.images))
  || jsonb_build_object('room_images', to_jsonb(r.images))
FROM hotels h JOIN rooms r ON r."hotelId" = h.id
WHERE b.hotel_id = h.id AND b.room_id = r.id
  AND b.hotel_id IN ('hco-seed-hdw','hco-seed-vns','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo');

-- verify: SELECT id, images[1] FROM hotels WHERE id IN ('hco-seed-hdw','hco-seed-vns','hco-seed-bhi','hco-seed-muk','hco-seed-ksl','hco-seed-chl','hco-seed-dhr','hco-seed-bir','hco-seed-nmr','hco-seed-mth','hco-seed-vrn','hco-seed-ayo') ORDER BY id;