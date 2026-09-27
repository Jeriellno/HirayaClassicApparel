MEDIUM — Data inconsistency / dead code
13. guest_ai_access toggle ay hindi ginagamit kahit saan SettingsTab.jsx:22-25 may toggle para sa "Guest AI Access", at SuperAdminController::publicStatus() nagre-return nito. Ngunit ang App.jsx:67 hindi ito binabasa — sinasabi mismo ng comment sa line 58: "guestAiAccess but NOTHING read them". Resulta: toggling it changes nothing — ang eksaktong "live-looking but inert" problem na iniiwasan ng code base.

14. Dashboard "Sync Pipelines" naghihintay ng 7 requests na hindi kailangan SuperAdmin.jsx:126-141 — fetchAllDatabaseData() ay Promise.all ng 7 endpoints. Sa single-threaded php artisan serve, ito ay nagiging hanggang 45s timeout (tugma sa axios.js:77 comment). Malaking bahagi nito ay inayos na ng lazy per-tab loading (#74-85), pero ang "Sync Pipelines" button ay pumipilit pa rin ng lahat.

15. is_online column — dead column User.php:31,62 at migration 2026_10_03_000001:29-30. May column at cast, walang writer at walang reader. Nire-replace na ng last_login_at (sinabi mismo ng comment sa AdminsTab.jsx:19-23).

16. SystemSetting::all() sa settings() walang timeout guard SuperAdminController.php:236 — hindi tulad ng publicStatus() (may cold-read budget at cache), ang /admin/settings ay direktang SystemSetting::all(). Kung mabagal ang pooler, mag-hang ito hanggang 45s.

17. export() — hindi talaga "streamed" SuperAdminController.php:324-339 — ang comment ay nagsasabing "Streamed (not buffered) so a large catalog cannot exhaust memory", pero ang Product::all(), Order::with('orderItems')->get(), atbp ay lahat naka-load sa memory bago pa i-echo. Ang streamDownload callback ay nag-e-echo lang ng $payload na buo nang na-built. Sa malaking catalog, ito ay maubos ang memory — baliktad ng sinasabi ng comment.

18. AdminsTab — disabled inputs walang name attribute AdminsTab.jsx:337-344 at :351-360 — ang Name at Email inputs ay may disabled={!!editingAccount} ngunit walang name prop. Hindi naman problema habang disabled, pero kung i-enable sa hinaharap, hindi mag-a-update ang formData.