// ═══════════════════════════════════════════════════════════════════════════
// responsive-audit.mjs — the reusable full-matrix responsive/a11y harness.
//
// One committed tool for the whole UI/UX program. For a given route it measures,
// in BOTH themes across the full device matrix, four hard gates:
//   • horizontal overflow (page must never scroll sideways)
//   • WCAG AA text contrast (composited over the real bg stack)
//   • lucide SVG-icon contrast (currentColor vs its tile)
//   • decorative-emoji scan (a global keep-set of brand/content glyphs is allowed)
// plus two responsive-fit gates:
//   • no readable text block wider than MAX_LINE (ultra-wide line-length)
//   • min rendered font floor (nothing below FONT_FLOOR px)
//
// Device matrix (px): 280 Fold-cover · 320 · 360 · 390 · 414 · 768 · 834 iPad ·
//   1024 · 1280 · 1440 · 1536 · 1920 · 2560.
//
// Usage: node docs/upgrade/responsive-audit.mjs <baseURL> [routeGlob]
// Routes + fixtures are declared in ROUTES below (generic API fallback provided).
// This is a MEASUREMENT tool — it never mutates the app.
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:3960';
const ONLY = process.argv[3] || '';
const WIDTHS = (process.env.AUDIT_WIDTHS ? process.env.AUDIT_WIDTHS.split(',').map(Number) : [280, 320, 360, 390, 414, 768, 834, 1024, 1280, 1440, 1536, 1920, 2560]);
const THEMES = ['light', 'dark'];
const MAX_LINE = 1500;   // a single text block wider than this reads as "stretched"
const FONT_FLOOR = 10;   // px — flag genuinely-tiny text (< floor). 10px micro-labels
                         // sit at the design's --fs-micro floor and pass.

// brand/content glyphs intentionally kept program-wide (hybrid rule)
const KEEP = new Set(['←','→','↑','↓','↗','↘','↩','⇅','⇄','↔','›','‹','·','–','—','✓','✕','×','★','☆','♥','♡',
  '👋','✨','🔥','🏠','🔑','🏷','🏔','🏨','◎','📍','📱','🎉','🛏','●','○','▶','◀','🥇','🥈','🥉','🏆','😊','😐','😞',
  // home "The Stage" brand/content/season glyphs (hybrid keep)
  '❄️','🌸','☀️','🌧️','🍂','🛕','⚡','🎬','💎','✦','🧭','🌟','💚','✈️','🚗','❄','🌧','💫','🎯','🛂','◆',
  // reel/profile content-vocabulary: story-highlight covers + nav menu glyph (hybrid keep)
  '🌄','🏖','🍜','🎒','☰','↺',
  // partner empty-state illustrations (36px, centred) + reload glyph (matches ↺) (hybrid keep)
  '📭','🛟','↻','🙌',
  // creator/referral share-channel + caption glyphs (brand vocabulary; lucide has no brand marks) (hybrid keep)
  '💬','📸','📲','🌅','🎵','👆','👉','👇','🔗',
  // circle content vocabulary: property/destination types + season/weather glyphs (hybrid keep)
  '🏡','🏘','🏛','🛖','🌴','☁️','☁','☕','⬆','⛺','🌲','🌳','🌾','🏢','🪵',
  // city/destination + location-picker glyphs (lib/cities CITY_ICON + globe/GPS) (hybrid keep)
  '🏙','⛰','🏰','🕉','🌨','🏂','🐪','🛰','🌏','🌐',
  // food/hospitality/social content-vocabulary: F&B ordering + IG profile tabs (hybrid keep)
  '🍽','🍴','🛎','📷','📖','🤷',
  // review/feedback content-vocabulary: rating star + sentiment + feedback categories (hybrid keep)
  '⭐','🙂','🤝','🧼','💭']);

function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum({r,g,b}){return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);}
function ratio(a,b){const l1=lum(a),l2=lum(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);}
function parse(str){if(!str)return null;const m=String(str).match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(',').map(s=>parseFloat(s.trim()));return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
function comp(fg,bg){const a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)};}

// { route, scope (CSS root of the surface), auth?, ls?, fixtures: {urlSubstr: json} }
const GENERIC = { ok:true, config:null, locks:[], properties:[], tables:[], creators:[], users:[], bookings:[], rows:[] };
const HOTELS = [
  {id:'h1',name:'Cave View Resort',city:'Dehradun',state:'UK',starRating:4,images:['x'],image:'x',fromPrice:2400,cheapestPrice:2400,rooms:[{id:'r1',name:'Deluxe'}]},
  {id:'h2',name:'Ridge Retreat',city:'Mussoorie',state:'UK',starRating:5,images:['x'],image:'x',fromPrice:3200,cheapestPrice:3200,rooms:[{id:'r2',name:'Suite'}]},
  {id:'h3',name:'Riverside Camp',city:'Rishikesh',state:'UK',starRating:3,images:['x'],image:'x',fromPrice:1800,cheapestPrice:1800,rooms:[{id:'r3',name:'Tent'}]},
];
const ADMIN_FX = { kpis:{users:1240,bookings:380,revenue:1200000,hotels:42,complaints:3,pendingContent:2,payoutsOwed:14000}, ledger:[], payouts:[], bookings:[], holds:[], hotels:[], topCreators:[], codes:[], complaints:[], feedback:[], flags:[], users:[], creators:[], counts:{} };
const CIRCLE_PROPS = { cities:['Dehradun'], properties:[{id:'p1',title:'Cave View Villa',city:'Dehradun',state:'UK',locationLabel:'Rajpur, Dehradun',images:[],monthlyRate:30000,roiMin:15,roiMax:28,occupancyLabel:'High',badges:['Trending'],operationModel:'managed',status:'open',roomTypes:[{id:'r1',name:'Deluxe',monthlyRate:30000,availableUnits:3}]}] };
const CIRCLE_PORTFOLIO = { ownedBlocks:2, activeListings:1, inventoryValue:60000, b2bNetEarned:12000, payoutsReceived:4400, blocks:[{id:'b1',hotel_name:'Cave View',unit_number:'12',date_from:'2026-08-01',date_to:'2026-08-04',nights:3,status:'owned'}], listings:[], trades:[], operatedHotels:[{id:'h1',name:'Cave View Resort'}] };
const INF_ME = { registered:true, influencer:{ id:'i1', display_name:'Asha Verma', handle:'asha', bio:'Travel creator sharing hill-station gems.', verification_tier:2, aadhaar_verified:true, pan_verified:true, total_earnings:24500, status:'active', total_followers:8200, hotel_id:null, instagram:'asha.travels', avatar_url:null } };
const INF_STATS = { derived:{ monthlyCommission:4200, monthlyBookings:6, pendingCommission:1800, totalBookings:34 } };
const INF_EARN = { commissions:[ {id:'cm1',booking_amount:4800,commission_amount:480,commission_percentage:10,status:'cleared',hotel_id:'h1',created_at:'2026-07-20 10:00:00'}, {id:'cm2',booking_amount:3200,commission_amount:320,commission_percentage:10,status:'pending',hotel_id:'h2',created_at:'2026-07-25 10:00:00'} ] };
const INF_CODES = { codes:[ {id:'rc1',code:'ASHA10',label:'Instagram bio',clicks_count:120,conversions_count:8}, {id:'rc2',code:'HILLS5',label:'YouTube',clicks_count:64,conversions_count:3} ] };
const INF_BOOKINGS = { bookings:[ {bidId:'bid_abc123456',amount:4800,commission:480,status:'ACCEPTED',source:'reel',flow:'bid',paid:true,createdAt:'2026-07-20 10:00:00',checkIn:'2026-08-10',hotelName:'Cave View Resort'} ] };
const ROUTES = [
  { route:'/', scope:'body',
    fixtures:{
      'bids/insights':{ ok:true, totalBids:1240, hotelsLive:38, avgSavingPct:22, recentWins:[{hotel:'Cave View',city:'Dehradun',saved:1200},{hotel:'Ridge Retreat',city:'Mussoorie',saved:900}] },
      'flash/near':{ ok:true, deals:[{id:'d1',hotelId:'h1',hotelName:'Cave View Resort',city:'Dehradun',roomName:'Deluxe',marketRate:3000,aiPrice:2400,discount:48,image:'x',images:['x']},{id:'d2',hotelId:'h2',hotelName:'Ridge Retreat',city:'Mussoorie',roomName:'Suite',marketRate:5000,aiPrice:3200,discount:40,image:'x',images:['x']}] },
      'hotels/starting-prices':{ ok:true, prices:{h1:2400,h2:3200,h3:1800} },
      'hotels/scorecards':{ ok:true, scores:{h1:{overall:8.6,tier:'gold'},h2:{overall:9.1,tier:'platinum'},h3:{overall:7.4,tier:'silver'}} },
      'hotels':{ ok:true, hotels:HOTELS },
      'social/feed':{ ok:true, posts:[{id:'p1',media_url:'x',thumbnail_url:'x',caption:'Sunset at Cave View',hotel_id:'h1',hotel_name:'Cave View',like_count:42,author_name:'Asha'},{id:'p2',media_url:'x',thumbnail_url:'x',caption:'Ridge morning',hotel_id:'h2',hotel_name:'Ridge',like_count:31,author_name:'Rin'}] },
      'circle/properties':{ ok:true, cities:['Dehradun'], properties:[{id:'p1',title:'Cave View Villa',city:'Dehradun',state:'UK',images:['x'],monthlyRate:30000,roiMin:15,roiMax:28,status:'open',roomTypes:[{id:'r1',monthlyRate:30000}]}] },
      'circle/marketplace-summary':{ ok:true, model3:{count:8,fromPrice:2100}, model4:{count:5,fromPrice:9000} },
      'trade/lots':{ ok:true, lots:[{id:'l1',hotel_name:'Cave View',city:'Dehradun',min_bid_per_room_night:1200,num_rooms:4,sale_mode:'live'}] },
    } },
  { route:'/circle', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma"}'},
    fixtures:{ 'circle/properties': { cities:['Dehradun'], properties:[{id:'p1',title:'Cave View Villa',city:'Dehradun',state:'UK',locationLabel:'Rajpur, Dehradun',images:[],monthlyRate:30000,roiMin:15,roiMax:28,occupancyLabel:'High',badges:['Trending'],operationModel:'managed',status:'open',roomTypes:[{id:'r1',name:'Deluxe',monthlyRate:30000,availableUnits:3}]}] } } },
  { route:'/circle/dashboard', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}',sb_circle_locks_v1:'["p1"]'},
    fixtures:{ 'circle/properties':{properties:[{id:'p1',title:'Cave View Villa',city:'Dehradun',state:'UK',images:[],monthlyRate:30000,roiMin:15,roiMax:28,status:'open',roomTypes:[{id:'r1',monthlyRate:30000}]}]}, 'owned-summary':{ownsUnits:true,unitCount:2,hotelCount:1}, 'locks':{locks:[{property_id:'p1'}]} } },
  { route:'/admin/reports', scope:'body', admin:true,
    fixtures:{ 'admin':{ kpis:{}, ledger:[], payouts:[], bookings:[], holds:[], hotels:[], topCreators:[], codes:[], complaints:[], feedback:[], flags:[], users:[], creators:[] } } },
  { route:'/admin/rls', scope:'body', admin:true,
    fixtures:{ 'admin/rls':{ serviceRole:true, tables:[{table:'users',rls_enabled:true,policy_count:2,policies:[]},{table:'bookings',rls_enabled:true,policy_count:1,policies:[]},{table:'otp_codes',rls_enabled:false,policy_count:0,policies:[]}] } } },
  { route:'/circle/model2/browse', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma"}'},
    fixtures:{ 'city-access':{ activeCities:[], cityAccessPrice:999 }, 'b2b/marketplace':{ listings:[{id:'l1',listing_id:'l1',hotel_id:'h1',hotel_name:'Cave View',hotel_city:'Dehradun',city:'Dehradun',room_name:'Deluxe',buy_per_night:2000,market:{adr:2800,low:2400,high:3200}}] } } },
  { route:'/circle/model3', scope:'body',
    fixtures:{ 'circle/marketplace': { hotels:[{id:'h1',name:'Cave View Resort',city:'Dehradun',state:'UK',starRating:4,image:null,fromWholesale:2100,rooms:[{id:'r1',name:'Deluxe',type:'deluxe',image:null,capacity:2,fromWholesale:2100}]}] } } },
  { route:'/circle/model4', scope:'body',
    fixtures:{ 'b2b/marketplace': { listings:[{id:'l1',hotel_name:'Cave View',hotel_city:'Dehradun',unit_number:'12',date_from:'2026-08-01',date_to:'2026-08-04',nights:3,ask_total:9000}] } } },
  { route:'/admin/host', scope:'body', admin:true,
    fixtures:{ 'admin/host':{ kpis:{leads:3,leadsNew:1,portfolios:2,portfoliosActive:1,portfolioRevenue:1000,propertySubmissions:2,propertySubmissionsPending:1,inquiries:1,inquiriesNew:1,projects:1,orders:1,storeGmv:1,jobs:1,jobsActive:1,workforceRevenue:1,channels:1,channelsNew:1}, leads:[], portfolios:[], propertySubmissions:[], inquiries:[], projects:[], orders:[], jobs:[], channels:[] } } },

  // ── Admin panel (DARK-ONLY per owner decision 2 — judge the dark rows) ────
  { route:'/admin', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX } },
  { route:'/admin/users', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/users':{ users:[{id:'u1',name:'Asha Verma',phone:'+919812345678',role:'customer',isBlocked:false,createdAt:'2026-07-01'}], count:1 } } },
  { route:'/admin/bookings', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/bookings':{ bookings:[{id:'bk1',status:'CONFIRMED',hotelName:'Cave View',guestName:'Asha',totalAmount:4800,checkIn:'2026-09-10',checkOut:'2026-09-12'}] } } },
  { route:'/admin/hotels', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/hotels':{ hotels:[{id:'h1',name:'Cave View Resort',city:'Dehradun',approval_status:'approved',owner_type:'hotel_owner'}] } } },
  { route:'/admin/finance', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/finance':{ ledger:[], payouts:[], kpis:{revenue:120000,commission:14000,payoutsOwed:3000} } } },
  { route:'/admin/complaints', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/complaints':{ complaints:[{id:'c1',status:'open',subject:'AC not working',hotelName:'Cave View',createdAt:'2026-08-01'}] } } },
  { route:'/admin/content', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/content':{ posts:[], pending:[] } } },
  { route:'/admin/settings', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/settings':{ config:{} } } },
  { route:'/admin/analytics', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/analytics':{ kpis:{}, series:[] } } },
  { route:'/admin/verification', scope:'body', admin:true, fixtures:{ 'admin':ADMIN_FX, 'admin/verification':{ requests:[], videos:[] } } },

  // ── Circle remaining pages (signed-in investor) ──────────────────────────
  { route:'/circle/discover', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'circle/properties':CIRCLE_PROPS, 'circle/locks':{locks:[{property_id:'p1'}]} } },
  { route:'/circle/build', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}',sb_circle_build_v1:'{"propertyId":"p1","rooms":[{"roomTypeId":"r1","qty":1}]}'},
    fixtures:{ 'circle/properties':CIRCLE_PROPS, 'circle/revenue-config':{ config:{ occupancyPct:70, adr:4200 } } } },
  { route:'/circle/me', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'circle/me':{ bundles:[], payouts:[], locks:[] }, 'circle/portfolio':CIRCLE_PORTFOLIO, 'circle/city-access':{ activeCities:['Dehradun'], cityAccessPrice:999 }, 'circle/revenue-config':{ config:{occupancyPct:70,adr:4200} } } },
  { route:'/circle/earnings', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'circle/me':{ bundles:[], payouts:[{id:'py1',amount:4400,status:'paid',month:'2026-07'}], locks:[] }, 'circle/payout-account':{ account:{type:'upi',upi:'asha@okhdfc',status:'verified'} }, 'circle/projected-earnings':{ projectedNetOwed:5600, projectedGross:6400, bookingCount:2, nightsCount:5, feePct:12, items:[] } } },
  { route:'/circle/kyc', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'circle/kyc':{ status:'pending', kyc:null } } },
  { route:'/circle/onboard', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'circle/onboard':{ ok:true, application:null } } },
  { route:'/circle/profile', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678","email":"asha@example.com"}'}, fixtures:{} },
  { route:'/circle/support', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'}, fixtures:{} },
  { route:'/circle/demand-cycle', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma"}'},
    fixtures:{ 'circle/properties':CIRCLE_PROPS } },
  { route:'/circle/model2', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma"}'},
    fixtures:{ 'circle/properties':CIRCLE_PROPS } },
  { route:'/circle/model2/review', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}',sb_m2_basket_v1:'[{"listingId":"l1","hotelName":"Cave View","roomName":"Deluxe","city":"Dehradun","dates":["2026-08-01","2026-08-02"],"buyPerNight":2000}]'},
    fixtures:{ 'circle/city-access':{ activeCities:['Dehradun'], cityAccessPrice:999 }, 'b2b/market-quote':{ window:true, blocked:[], ownPerNight:1000, buyPerNight:2000, buyerFeePct:5, market:{adr:2800,low:2400,high:3200} } } },
  { route:'/circle/model2/selling', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'circle/portfolio':CIRCLE_PORTFOLIO } },

  // ── Partner surface ──────────────────────────────────────────────────────
  { route:'/partner', scope:'body', fixtures:{} },
  { route:'/partner/dashboard', scope:'body',
    ls:{sb_partner_token:'t', sb_partner_user:'{"id":"p1","name":"Cave View Owner","hotelId":"h1","hotel":{"id":"h1","name":"Cave View Resort","city":"Dehradun"}}', sb_partner_active_hotel:'h1'},
    fixtures:{
      'partner/hotel':{ hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', state:'UK', starRating:4, ownerId:'p1', account_type:'hotel_owner', images:['x'], amenities:['Wi-Fi','Pool'], approval_status:'approved', rooms:[{id:'r1',name:'Deluxe',floorPrice:2400,basePrice:3200,capacity:2,totalRooms:6}], isOperator:false, ownedUnits:[] }, bookings:[{id:'bk1',status:'CONFIRMED',guestName:'Asha',roomName:'Deluxe',checkIn:'2026-09-10',checkOut:'2026-09-12',totalAmount:4800,numRooms:1}] },
      'partner/hotels':{ hotels:[{id:'h1',name:'Cave View Resort',city:'Dehradun'}], count:1 },
      'partner/bids':{ bids:[{id:'b1',status:'PENDING',guestName:'Rin',roomName:'Deluxe',bidAmount:2400,checkIn:'2026-09-10',checkOut:'2026-09-12',numRooms:1,createdAt:'2026-08-03 10:00:00'}] },
      'partner/services':{ services:[{service_key:'bids',status:'active'},{service_key:'rooms',status:'active'}] },
      'partner/calendar':{ ok:true, days:[] }, 'partner/room-units':{ units:[] }, 'partner/room-pricing':{ ok:true, config:{} },
      'partner/complaints':{ complaints:[] }, 'partner/flash-deals':{ deals:[] }, 'partner/ota-feeds':{ feeds:[] },
      'partner/content/pending':{ posts:[] }, 'partner/autopilot':{ mode:'hybrid' }, 'partner/walk-in':{ ok:true },
    } },
  { route:'/partner/staff', scope:'body',
    ls:{sb_partner_token:'t', sb_partner_user:'{"id":"p1","name":"Cave View Owner","hotelId":"h1","hotel":{"id":"h1","name":"Cave View Resort","city":"Dehradun"}}'},
    fixtures:{ 'partner/hotel':{ hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', ownerId:'p1', rooms:[], isOperator:false, ownedUnits:[] }, bookings:[] } } },
  { route:'/partner/verification', scope:'body',
    ls:{sb_partner_token:'t', sb_partner_user:'{"id":"p1","name":"Cave View Owner","hotelId":"h1","hotel":{"id":"h1","name":"Cave View Resort","city":"Dehradun"}}'},
    fixtures:{ 'partner/hotel':{ hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', ownerId:'p1', rooms:[], isOperator:false, ownedUnits:[] }, bookings:[] } } },

  // ── Trade (Model 3 travel-agent auction) ─────────────────────────────────
  { route:'/trade', scope:'body',
    fixtures:{ 'trade/lots':{ ok:true, cities:['Dehradun','Mussoorie'], lots:[
      { id:'lot1', hotel_id:'h1', room_id:'r1', category:'Deluxe Valley', city:'Dehradun', month_key:'2026-09', num_rooms:6, min_bid_per_room_night:2300, window_close_at:'2026-09-30', sale_mode:'live', image:'x', metadata:{ hotel_name:'Cave View Resort' } },
      { id:'lot2', hotel_id:'h2', room_id:'r2', category:'Ridge Suite', city:'Mussoorie', month_key:'2026-10', num_rooms:4, min_bid_per_room_night:3100, window_close_at:'2026-10-31', sale_mode:'sealed', image:'x', metadata:{ hotel_name:'Ridge Retreat' } },
    ] } } },
  { route:'/trade/lot1', scope:'body',
    fixtures:{ 'trade/lots/lot1':{ ok:true, depositPct:10, buyerPremiumPct:5, roomsAvailable:6, live:{ autopilot:'hybrid' }, segments:[{ type:'full', label:'Full month' },{ type:'week', label:'A week' },{ type:'weekend', label:'Weekends' }], market:{ rack:4900, adr:2867, low:2400, high:3400 },
      lot:{ id:'lot1', hotel_id:'h1', room_id:'r1', category:'Deluxe Valley', city:'Dehradun', month_key:'2026-09', num_rooms:6, min_bid_per_room_night:2300, window_close_at:'2026-09-30', sale_mode:'live', metadata:{} },
      hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', star:4, description:'A serene hillside retreat with valley views.', images:['x','x','x'] },
      room:{ id:'r1', name:'Deluxe Valley', images:['x'], capacity:2 } } } },
  { route:'/trade/my-bids', scope:'body',
    ls:{ sb_trade_token:'t', sb_trade_user:'{"uid":"ag1","name":"Ravi Agent","email":"ravi@example.com"}' },
    fixtures:{
      'trade/awards/mine':{ ok:true, awards:[{ id:'aw1', bid_id:'bd1', hotel_id:'h1', city:'Dehradun', month_key:'2026-09', segment_label:'Full month', rooms_awarded:2, base_total:9600, buyer_fee:480, amount_due:10080, deposit_applied:0, status:'awarded', voucher_code:null, night_dates:[], metadata:{ hotel_name:'Cave View Resort' } }] },
      'trade/bids/mine':{ ok:true, bids:[{ id:'bd2', lot_id:'lot2', status:'active', segment_label:'Weekends', per_room_per_night:3100, rooms_wanted:2, deposit_amount:1240, counter_per_room_per_night:null, lot:{ city:'Mussoorie', month_key:'2026-10', metadata:{ hotel_name:'Ridge Retreat' } }, metadata:{} }] },
    } },
  { route:'/trade/review', scope:'body',
    ls:{ sb_trade_token:'t', sb_trade_user:'{"uid":"ag1","name":"Ravi Agent"}', sb_trade_bidbasket_v1:'[{"lotId":"lot1","segmentType":"full","weekIndex":null,"perRoomPerNight":2300,"roomsWanted":2,"segmentLabel":"Full month · Sep 2026","hotelName":"Cave View Resort","city":"Dehradun"}]' },
    fixtures:{ 'trade/lots/lot1':{ ok:true, depositPct:10, buyerPremiumPct:5, lot:{ id:'lot1', city:'Dehradun', month_key:'2026-09', min_bid_per_room_night:2300, sale_mode:'live' }, hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun' }, room:{ id:'r1', name:'Deluxe Valley' } } } },

  // ── Onboard (hotel self-signup wizard) ───────────────────────────────────
  { route:'/onboard', scope:'body', fixtures:{} },
  { route:'/onboard/signin', scope:'body', fixtures:{} },
  { route:'/onboard/signup', scope:'body', fixtures:{} },
  { route:'/onboard/verify', scope:'body', ls:{ sb_onboard_token:'t', sb_onboard_user:'{"id":"o1","name":"New Owner","phone":"+919812345678"}' }, fixtures:{} },
  { route:'/onboard/wizard', scope:'body',
    ls:{ sb_onboard_token:'t', sb_onboard_user:'{"id":"o1","name":"New Owner","phone":"+919812345678"}', sb_onboard_draft:'{"basics":{"name":"Cave View Resort","city":"Dehradun"}}' }, fixtures:{} },

  // ── Agent (customer-support panel) ───────────────────────────────────────
  { route:'/agent/login', scope:'body', fixtures:{} },
  { route:'/agent', scope:'body', ls:{ sb_agent_token:'t', sb_agent_user:'{"id":"a1","name":"Support Agent","role":"agent"}' },
    fixtures:{ 'support/conversations':{ ok:true, conversations:[{ id:'cv1', subject:'Booking help', status:'open', last_message:'Need to change dates', updated_at:'2026-08-01 10:00:00', user_name:'Asha', unread:2, channel:'chat' }] }, 'support/metrics':{ ok:true, open:3, resolved:12, avgResponseMin:8 }, 'support/suggest':{ ok:true, suggestion:'' } } },
  { route:'/agent/metrics', scope:'body', ls:{ sb_agent_token:'t', sb_agent_user:'{"id":"a1","name":"Support Agent","role":"agent"}' },
    fixtures:{ 'support/metrics':{ ok:true, open:3, resolved:12, pending:1, avgResponseMin:8, avgResolutionHrs:4, byDay:[], byAgent:[{ name:'Support Agent', resolved:12, avgMin:8 }], totals:{ conversations:15, messages:120 } } } },
  { route:'/agent/cv1', scope:'body', ls:{ sb_agent_token:'t', sb_agent_user:'{"id":"a1","name":"Support Agent","role":"agent"}' },
    fixtures:{ 'support/ai-status':{ ok:true, enabled:false }, 'support/conversations/cv1':{ ok:true, conversation:{ id:'cv1', subject:'Booking help', status:'open', user_name:'Asha', channel:'chat', created_at:'2026-08-01 09:00:00' }, messages:[{ id:'m1', sender:'user', body:'Hi, I need to change my check-in date.', created_at:'2026-08-01 09:00:00' },{ id:'m2', sender:'agent', body:'Sure, I can help with that. Which booking?', created_at:'2026-08-01 09:02:00' }] }, 'support/suggest':{ ok:true, suggestion:'' } } },

  // ── Kiosk (offline kiosk: hub / touchscreen booking / big display board) ──
  { route:'/kiosk', scope:'body', fixtures:{} },
  { route:'/kiosk/book', scope:'body',
    fixtures:{ 'kiosk/feed':{ ok:true, deals:[{ id:'d1', hotelId:'h1', hotelName:'Rishikesh Ganga View', hotel_name:'Rishikesh Ganga View', city:'Rishikesh', roomName:'Deluxe Valley', room_name:'Deluxe Valley', marketRate:5000, market_rate:5000, aiPrice:3200, ai_price:3200, price:3200, discount:36, starRating:4, star_rating:4, image:'x', images:['x'], distanceKm:2, rooms:[{ id:'r1', name:'Deluxe Valley', price:3200 }] }] } } },
  { route:'/kiosk/display', scope:'body',
    fixtures:{ 'kiosk/feed':{ ok:true, deals:[{ id:'d1', hotelName:'Rishikesh Ganga View', hotel_name:'Rishikesh Ganga View', city:'Rishikesh', roomName:'Deluxe Valley', marketRate:5000, aiPrice:3200, price:3200, discount:36, starRating:4, image:'x', images:['x'], badge_emoji:'⭐', delta:1800 }] } } },

  // ── Complaints (customer support) ────────────────────────────────────────
  { route:'/complaints', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'complaints':{ complaints:[{ id:'c1', subject:'AC not working', status:'OPEN', createdAt:'2026-08-01 10:00:00', hotelName:'Cave View Resort' }] }, 'complaints/mine':{ complaints:[] } } },

  // ── Influencer / creator hub (registered creator) ────────────────────────
  { route:'/influencer/dashboard', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'influencer/me':INF_ME, 'i1/stats':INF_STATS, 'i1/earnings':INF_EARN } },
  { route:'/influencer/profile', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'influencer/me':INF_ME } },
  { route:'/influencer/earnings', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'influencer/me':INF_ME, 'i1/earnings':INF_EARN } },
  { route:'/influencer/referrals', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'influencer/me':INF_ME, 'i1/codes':INF_CODES } },
  { route:'/influencer/bookings', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'influencer/me':INF_ME, 'i1/bookings':INF_BOOKINGS } },
  { route:'/influencer/upload', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'influencer/me':INF_ME, 'hotels':{ ok:true, hotels:HOTELS } } },
  { route:'/influencer/public/pub1', scope:'body',
    fixtures:{ 'influencer/public/pub1':{ ok:true, influencer:{ id:'pub1', display_name:'Asha Verma', handle:'asha', bio:'Travel creator sharing hill-station gems.', total_followers:8200, verification_tier:2, avatar_url:null, instagram:'asha.travels' }, videos:[], stats:{ videos:12, followers:8200 } } } },

  // ── Customer frontend (the main app) ─────────────────────────────────────
  { route:'/hotels', scope:'body',
    fixtures:{ 'hotels/scorecards':{ok:true,scores:{h1:{overall:8.6,tier:'gold'},h2:{overall:9.1,tier:'platinum'},h3:{overall:7.4,tier:'silver'}}}, 'hotels':{ok:true,hotels:HOTELS} } },
  { route:'/hotels/h1', scope:'body',
    fixtures:{ 'hotels/h1':{ hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', state:'UK', starRating:4, account_type:'hotel_owner', description:'A serene hillside retreat with valley views, curated interiors and a warm, personal welcome.', images:['x','x','x'], amenities:['Wi-Fi','Pool','Breakfast','Parking','Spa'], lat:30.3, lng:78.0, avgRating:4.6, totalReviews:128, rooms:[{id:'r1',name:'Deluxe Valley',floorPrice:2400,basePrice:3200,capacity:2,images:['x'],amenities:['Balcony','AC'],meal_plans:['EP','CP']},{id:'r2',name:'Premier Suite',floorPrice:3600,basePrice:4800,capacity:3,images:['x'],amenities:['Living room','Bathtub'],meal_plans:['CP','MAP']}], reviews:[{id:'rv1',rating:5,text:'Lovely stay',author:'Asha'}], individualRooms:false, roomListings:[] } }, 'hotels/scorecards':{ok:true,scores:{h1:{overall:8.6,tier:'gold'}}}, 'availability':{ok:true,available:true,blocked:[]}, 'availability/units':{ok:true,units:[]}, 'hotel-hold-config':{ok:true}, 'bids/auto-accept-info':{ok:true}, 'pricing/spine':{ok:true,prices:{}} } },
  { route:'/flash-deals', scope:'body',
    fixtures:{ 'flash/near':{ ok:true, deals:[{id:'d1',hotelId:'h1',hotelName:'Cave View Resort',city:'Dehradun',roomName:'Deluxe',marketRate:3000,aiPrice:2400,discount:48,image:'x',images:['x']},{id:'d2',hotelId:'h2',hotelName:'Ridge Retreat',city:'Mussoorie',roomName:'Suite',marketRate:5000,aiPrice:3200,discount:40,image:'x',images:['x']},{id:'d3',hotelId:'h3',hotelName:'Riverside Camp',city:'Rishikesh',roomName:'Tent',marketRate:2500,aiPrice:1800,discount:28,image:'x',images:['x']}] } } },
  { route:'/bid', scope:'body',
    fixtures:{ 'bids/insights':{ok:true,totalBids:1240,hotelsLive:38,avgSavingPct:22,recentWins:[]}, 'bids/my':{bids:[]}, 'hotels':{ok:true,hotels:HOTELS} } },
  { route:'/my-bids', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'bids/my':{ bids:[{id:'b1',status:'PENDING',hotelName:'Cave View Resort',hotelId:'h1',city:'Dehradun',roomName:'Deluxe',bidAmount:2400,numRooms:1,checkIn:'2026-09-10',checkOut:'2026-09-12',createdAt:'2026-08-01 10:00:00',source:'place'},{id:'b2',status:'ACCEPTED',hotelName:'Ridge Retreat',hotelId:'h2',city:'Mussoorie',roomName:'Suite',bidAmount:3200,numRooms:2,checkIn:'2026-09-15',checkOut:'2026-09-17',createdAt:'2026-08-02 11:00:00',expiresAt:'2026-08-30 11:00:00',source:'negotiate'}] }, 'bids/auto-accept-info':{ok:true}, 'my/unit-assignments':{assignments:[]}, 'bid/paid':{ok:true} } },
  { route:'/bookings', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'bookings/my':{ bookings:[{id:'bk1',status:'CONFIRMED',hotelName:'Cave View Resort',hotelId:'h1',city:'Dehradun',roomName:'Deluxe',totalAmount:4800,numRooms:1,checkIn:'2026-09-10',checkOut:'2026-09-12',code:'STY-12AB'}] }, 'holds':{holds:[]}, 'my/unit-assignments':{assignments:[]}, 'bid/paid':{ok:true} } },
  { route:'/passport', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'passport':{ profile:{explorer_id:'EXP-001',member_since:'2026-01-01',display_name:'Asha Verma',rank_key:'wanderer',xp:420}, rank:{rank:{key:'wanderer',label:'Wanderer'},next:{key:'voyager',label:'Voyager',xpTo:580},progressPct:62}, stats:{stays:3,cities:2,reviews:1,savedTotal:5600}, stamps:[{id:'s1',city:'Dehradun',date:'2026-03-01'},{id:'s2',city:'Mussoorie',date:'2026-05-01'}], badges:[{key:'first_stay',label:'First Stay',earned:true},{key:'explorer',label:'Explorer',earned:false}], rewards:[{code:'WELCOME',label:'Welcome ₹500',status:'available'}] } } },
  { route:'/wallet', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'passport':{ profile:{explorer_id:'EXP-001',member_since:'2026-01-01',display_name:'Asha',rank_key:'wanderer',xp:420}, rank:{rank:{key:'wanderer',label:'Wanderer'},next:{key:'voyager',label:'Voyager',xpTo:580},progressPct:62}, stats:{stays:3,cities:2,reviews:1,savedTotal:5600}, stamps:[], badges:[], rewards:[{code:'WELCOME',label:'Welcome ₹500',status:'available'}] } } },
  { route:'/points', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha","phone":"+919812345678"}'},
    fixtures:{ 'passport':{ profile:{explorer_id:'EXP-001',member_since:'2026-01-01',display_name:'Asha',rank_key:'wanderer',xp:420}, rank:{rank:{key:'wanderer',label:'Wanderer'},next:{key:'voyager',label:'Voyager',xpTo:580},progressPct:62}, stats:{stays:3,cities:2,reviews:1,savedTotal:5600}, stamps:[], badges:[], rewards:[] } } },
  { route:'/auth', scope:'body', fixtures:{} },
  { route:'/profile', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678","email":"asha@example.com"}'}, fixtures:{} },
  // ── Reel surfaces (hide Navbar/dock; phone-frame reel player) ─────────────
  { route:'/discover', scope:'body',
    fixtures:{ 'discover/feed':{ok:true,items:[{id:'i1',type:'reel',hotelId:'h1',hotelName:'Cave View',city:'Dehradun',media_url:'x',thumbnail_url:'x',caption:'Sunset',like_count:42}]}, 'social/feed':{ok:true,posts:[]}, 'flash/near':{ok:true,deals:[]}, 'hotels':{ok:true,hotels:HOTELS} } },
  { route:'/reels', scope:'body',
    fixtures:{ 'videos/feed':{ok:true,videos:[{id:'v1',hotelId:'h1',hotelName:'Cave View',city:'Dehradun',s3_url:'x',thumbnail_url:'x',caption:'Tour',like_count:12,author_name:'Asha'}]}, 'hashtags/trending':{ok:true,tags:['#dehradun','#hills']} } },
  { route:'/me', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'social/profiles/me':{ok:true,profile:{display_name:'Asha Verma',username:'asha',follower_count:12,is_verified:false,bio:'Traveller'}}, 'influencer/my-videos':{ok:true,videos:[]}, 'social/feed':{ok:true,posts:[]} } },

  // ── Bucket A: previously-unswept surfaces (dual-theme) ───────────────────
  { route:'/upgrade', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'tier/status':{ok:true,tier:'PUBLIC'}, 'social/profiles/me':{ok:true,profile:{display_name:'Asha'}}, 'upgrade/status':{ok:true} } },
  { route:'/verification', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'},
    fixtures:{ 'verification/status':{ok:true,status:'none'}, 'user/verification':{ok:true} } },
  { route:'/verification/record', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'}, fixtures:{ 'verification/status':{ok:true,status:'none'} } },
  { route:'/influencer/register', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'}, fixtures:{ 'influencer/me':{ok:true,influencer:null} } },
  { route:'/saved', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'}, fixtures:{ 'discover/saves/enriched':{ saves:[] } } },
  { route:'/tag/dehradun', scope:'body', fixtures:{ 'social/feed':{ok:true,posts:[]}, 'hashtags/dehradun':{ok:true,posts:[]} } },
  { route:'/order/o1', scope:'body', fixtures:{ 'order/outlet/o1':{ok:true,outlet:{id:'o1',name:'Cafe Ridge',items:[]}} } },
  { route:'/circle/c1', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}'}, fixtures:{ 'circle/properties':CIRCLE_PROPS } },
  // IG fixed-dark cluster (Instagram-style; verify responsive/font — dark aesthetic intended)
  { route:'/social/profile/user1', scope:'body', fixtures:{ 'social/profiles/user1':{ok:true,profile:{id:'p1',user_id:'u9',user_type:'PUBLIC',display_name:'Asha',username:'asha',follower_count:12}}, 'social/feed':{ok:true,posts:[]} } },
  { route:'/u/user1', scope:'body', fixtures:{ 'social/profiles/user1':{ok:true,profile:{id:'p1',user_id:'u9',user_type:'PUBLIC',display_name:'Asha',username:'asha',follower_count:12}}, 'social/feed':{ok:true,posts:[]} } },
  { route:'/u/user1/posts', scope:'body', fixtures:{ 'social/feed':{ok:true,posts:[]} } },
  { route:'/saved/posts', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha"}'}, fixtures:{ 'discover/saves/enriched':{saves:[]} } },

  // ── Bucket B: token-aware unswept pages (workforce / trust / hotel sub-pages) ──
  { route:'/worker', scope:'body', fixtures:{} },
  { route:'/worker/dashboard', scope:'body', ls:{ sb_worker_token:'t', sb_worker:'{"id":"w1","name":"Ravi Kumar","phone":"+919812345678","role":"housekeeping"}' },
    fixtures:{ 'worker/jobs':{ ok:true, jobs:[{ id:'j1', title:'Room 204 cleaning', status:'assigned', hotel_name:'Cave View Resort', pay:300, scheduled_at:'2026-08-05 10:00:00' }] }, 'worker/me':{ ok:true, worker:{ id:'w1', name:'Ravi Kumar', role:'housekeeping', jobs_done:12, status:'approved' } } } },
  { route:'/trust', scope:'body', fixtures:{ 'hotels/scorecards':{ ok:true, scores:{} } } },
  { route:'/privacy-policy', scope:'body', fixtures:{} },
  { route:'/hotels/h1/feedback', scope:'body', ls:{ sb_token:'t', sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}' },
    fixtures:{ 'hotels/h1':{ hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', images:['x'] } }, 'bookings/my':{ bookings:[{ id:'bk1', status:'CONFIRMED', hotelId:'h1', hotelName:'Cave View Resort', checkIn:'2026-07-10', checkOut:'2026-07-12' }] }, 'feedback/mine':{ feedback:[] } } },
  { route:'/hotels/h1/reviews', scope:'body',
    fixtures:{ 'hotels/h1':{ hotel:{ id:'h1', name:'Cave View Resort', city:'Dehradun', avgRating:4.6, totalReviews:128, images:['x'] } }, 'hotels/h1/reviews':{ reviews:[{ id:'rv1', rating:5, text:'Lovely stay, great views.', author:'Asha', createdAt:'2026-07-01' },{ id:'rv2', rating:4, text:'Clean and comfortable.', author:'Rahul', createdAt:'2026-06-20' }] } } },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const summary = [];

for (const cfg of ROUTES) {
  if (ONLY && !(cfg.route === ONLY || (ONLY.length > 1 && cfg.route.includes(ONLY)))) continue;
  const rowFails = [];
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport:{width:w,height:900}, colorScheme:theme });
      const ls = { ...(cfg.ls||{}), sb_theme:theme };
      if (cfg.admin) { Object.assign(ls, { sb_admin_token:'t.t.t', sb_admin_user:'{"id":"a1","name":"Admin","role":"super_admin"}', sb_token:'t.t.t', sb_user:'{"id":"a1","name":"Admin","role":"super_admin"}' }); }
      await ctx.addInitScript((data)=>{ try{ for(const [k,v] of Object.entries(data.ls)) localStorage.setItem(k,v); sessionStorage.setItem('sb_welcome_shown','1'); }catch(e){} }, { ls });
      const page = await ctx.newPage();
      // Stub Google Fonts (blocked by the sandbox proxy). React 19 treats a
      // component-level <link rel=stylesheet>/@import as a "suspensey" resource
      // and holds the subtree hidden until it loads; on the blocked CDN that
      // never resolves, so pages like /agent/* /admin/login render empty. A 200
      // empty stylesheet lets React reveal the content (fallback fonts are fine
      // for geometry/contrast measurement).
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.fulfill({status:200,contentType:'text/css',body:'/* stub */'}));
      await page.route('**/api/**', route=>{
        const u = route.request().url();
        for (const [sub,json] of Object.entries(cfg.fixtures||{})) if (u.includes(sub)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(GENERIC)});
      });
      try { await page.goto(`${BASE}${cfg.route}`, { waitUntil:'domcontentloaded', timeout:20000 }); } catch(e){}
      // Some client pages settle via a router push/redirect on first load. On the
      // slower dev server that can destroy the evaluate context mid-measure, so
      // set-theme + measure are retried once behind a longer settle. A row that
      // still can't measure is recorded as NAVERR (never aborts the whole route).
      const EVAL_FN = (args)=>{
        const { scope, KEEParr, MAX_LINE, FONT_FLOOR } = args;
        // Strip the FE0F variation selector so '✈️' (kept) matches the base '✈'
        // the emoji regex actually captures (it does not include U+FE0F).
        const KEEP = new Set(KEEParr.map(s => s.replace(/️/g, '')));
        const root = document.querySelector(scope) || document.body;
        const de = document.documentElement;
        const overflow = de.scrollWidth > de.clientWidth + 1 ? { s:de.scrollWidth, c:de.clientWidth } : null;
        // helpers
        const P=(str)=>{ if(!str)return null; str=String(str);
          // modern CSS color(srgb r g b / a) — values 0..1, space-separated (Tailwind 4 / color-mix output).
          // The old rgb-only regex dropped these layers → mis-composited light text onto a white fallback.
          const cs=str.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/);
          if(cs){ return {r:parseFloat(cs[1])*255, g:parseFloat(cs[2])*255, b:parseFloat(cs[3])*255, a:cs[4]===undefined?1:parseFloat(cs[4])}; }
          const m=str.match(/rgba?\(([^)]+)\)/); if(!m)return null; const p=m[1].split(/[\s,\/]+/).map(x=>x.trim()).filter(Boolean).map(parseFloat); return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]}; };
        const bodyBg = P(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
        const emoji=[], tooWide=[], tiny=[];
        const RE=/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}✅✔✖]/gu;
        const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n;
        while((n=walk.nextNode())){ const t=n.textContent||''; const el=n.parentElement; if(!el||el.closest('script,style'))continue;
          // Skip elements hidden by an ANCESTOR's display:none — getComputedStyle(el).display
          // still returns 'inline' for them (display:none doesn't cascade to computed style),
          // so the desktop nav measured at mobile widths (and vice versa) produced false fails.
          if(el.getClientRects().length===0)continue;
          const cs=getComputedStyle(el); const fs=parseFloat(cs.fontSize)||16;
          if(cs.position==='fixed'&&cs.pointerEvents==='none')continue; // fixed dev-version chip
          const bad=[...(t.match(RE)||[])].filter(ch=>!KEEP.has(ch));
          if(bad.length && fs<40) emoji.push({t:t.trim().slice(0,18),bad});
          if(fs>0 && fs<FONT_FLOOR && t.trim()) tiny.push({t:t.trim().slice(0,18),fs:+fs.toFixed(1)});
          if(t.trim().length>40){ const rect=el.getBoundingClientRect(); if(rect.width>MAX_LINE) tooWide.push({t:t.trim().slice(0,18),w:Math.round(rect.width)}); }
        }
        // contrast (text)
        const els=Array.from(root.querySelectorAll('*')); const cfails=[];
        for(const el of els){ if(!el.childNodes)continue; if(el.tagName==='OPTION'||el.tagName==='SELECT')continue;
          const direct=Array.from(el.childNodes).some(c=>c.nodeType===3&&c.textContent.trim().length>0); if(!direct)continue;
          const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0)continue;
          if(el.getClientRects().length===0)continue; // ancestor display:none (not caught by cs.display)
          if(cs.position==='fixed'&&cs.pointerEvents==='none')continue;
          // A gradient OR a backdrop-filter (frosted glass) ancestor cannot be flat-composited,
          // so a computed contrast number would be wrong — skip those (documented limitation).
          const stk=[]; let cur=el, grad=false; while(cur){const s=getComputedStyle(cur); if(s.backgroundImage&&s.backgroundImage!=='none')grad=true; if((s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none'))grad=true; stk.push(s.backgroundColor); cur=cur.parentElement;}
          if(grad)continue;
          const fg=P(cs.color); if(!fg)continue;
          let bg={...bodyBg}; for(let i=stk.length-1;i>=0;i--){const b=P(stk[i]); if(b&&b.a>0){const a=b.a; bg={r:b.r*a+bg.r*(1-a),g:b.g*a+bg.g*(1-a),b:b.b*a+bg.b*(1-a)};}}
          const L=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
          const a=fg.a; const over={r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)};
          const l1=L(over),l2=L(bg),hi=Math.max(l1,l2),lo=Math.min(l1,l2); const cr=(hi+0.05)/(lo+0.05);
          const fs=parseFloat(cs.fontSize),fw=parseInt(cs.fontWeight)||400; const large=fs>=24||(fs>=18.66&&fw>=700); const min=large?3.0:4.5;
          if(cr<min-0.05) cfails.push({t:(el.textContent||'').trim().slice(0,16),cr:+cr.toFixed(2)});
        }
        // icon contrast — composite the FULL bg stack to the ground (same as text),
        // so an icon on a faint same-hue tint reads against the real card, not the tint.
        const L=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
        const ifails=[]; root.querySelectorAll('svg').forEach(svg=>{
          if(svg.getClientRects().length===0)return; // ancestor display:none
          const col=P(getComputedStyle(svg).color); if(!col)return;
          const stk=[]; let cur=svg.parentElement, grad=false;
          while(cur){const s=getComputedStyle(cur); if(s.backgroundImage&&s.backgroundImage!=='none')grad=true; if((s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none'))grad=true; stk.push(s.backgroundColor); cur=cur.parentElement;}
          if(grad)return; // gradient/glass tile — can't measure a flat bg; visual check covers it
          let bg={...bodyBg}; for(let i=stk.length-1;i>=0;i--){const b=P(stk[i]); if(b&&b.a>0){const a=b.a; bg={r:b.r*a+bg.r*(1-a),g:b.g*a+bg.g*(1-a),b:b.b*a+bg.b*(1-a)};}}
          const a=col.a; const over={r:col.r*a+bg.r*(1-a),g:col.g*a+bg.g*(1-a),b:col.b*a+bg.b*(1-a)};
          const l1=L(over),l2=L(bg),hi=Math.max(l1,l2),lo=Math.min(l1,l2); const cr=(hi+0.05)/(lo+0.05);
          if(cr<2.9) ifails.push(+cr.toFixed(2));
        });
        return { overflow, emoji:emoji.slice(0,6), tooWide:tooWide.slice(0,4), tiny:tiny.slice(0,4), cfails:cfails.slice(0,6), ifails:ifails.slice(0,6) };
      };
      const measure = async () => {
        await page.evaluate((th)=>document.documentElement.setAttribute('data-theme',th), theme);
        await page.waitForTimeout(2000);
        return page.evaluate(EVAL_FN, { scope: cfg.scope, KEEParr:[...KEEP], MAX_LINE, FONT_FLOOR });
      };
      let r;
      try { r = await measure(); }
      catch(e1){ try { await page.waitForTimeout(1200); r = await measure(); } catch(e2){ r = { naverr:true }; } }

      const issues = [];
      if (r.naverr) { issues.push('NAVERR (could not settle — re-run)'); }
      else {
        if (r.overflow) issues.push(`OVERFLOW ${r.overflow.s}>${r.overflow.c}`);
        if (r.emoji.length) issues.push(`EMOJI ${JSON.stringify(r.emoji)}`);
        if (r.cfails.length) issues.push(`TEXT ${JSON.stringify(r.cfails)}`);
        if (r.ifails.length) issues.push(`ICON ${JSON.stringify(r.ifails)}`);
        if (r.tooWide.length) issues.push(`WIDE ${JSON.stringify(r.tooWide)}`);
        if (r.tiny.length) issues.push(`TINY ${JSON.stringify(r.tiny)}`);
      }
      if (issues.length) rowFails.push(`  [${theme} ${w}] ${issues.join(' | ')}`);
      await ctx.close();
    }
  }
  const ok = rowFails.length===0;
  summary.push({ route: cfg.route, ok, n: rowFails.length });
  console.log(`\n### ${cfg.route} — ${ok?'CLEAN':rowFails.length+' issue-rows'}`);
  rowFails.forEach(l=>console.log(l));
}
console.log('\n\n═══ SUMMARY ═══');
summary.forEach(s=>console.log(`${s.ok?'✓':'✗'} ${s.route}${s.ok?'':' ('+s.n+')'}`));
console.log(summary.every(s=>s.ok) ? '\nALL ROUTES CLEAN across 13 widths × 2 themes' : `\n${summary.filter(s=>!s.ok).length} route(s) need work`);
await browser.close();
