# Surveillance Center — Audit, Architecture & Implementation Plan

> الحالة: **مقترح — لم يُكتب أي كود بعد.**
> التاريخ: 17 أغسطس 2026
> الجهاز المرجعي للاختبار: Dahua DH-XVR1B16-I (16-channel XVR)

---

## 1. Current Architecture Assessment

كل ما يلي **مُتحقَّق منه من الكود**، وليس افتراضات.

### 1.1 Backend

| العنصر | الواقع |
|---|---|
| Runtime | Node.js ESM، Express **5**، monolith واحد |
| Entry | `server/server.js` (2,466 سطر) — يركّب ~60 router تحت `/api/*` |
| Routers | `server/routes/*.js` — كل ملف يستورد `protect` + `permit` بنفسه |
| Services | `server/services/*.js` |
| Utils | `server/utils/*.js` |
| Server deps | `server/package.json` **بلا dependencies** — كل شيء من `node_modules` بالجذر |

نمط الـrouter الحديث (المرجع: [aiWorkflows.js](server/routes/aiWorkflows.js)):

```js
router.get("/tools", protect, permit("settings", "view"), (req, res) => { ... });
```

> ⚠️ **`server/services/` مُستبعَد من git افتراضيًا.** [.gitignore:41-65](.gitignore) يحوي `server/services/*` ثم قائمة `!` صريحة. أي service جديد **لن يُرفع ولن يُنشر** ما لم يُضَف له سطر `!` — والأخطر أنه يعمل محليًا بشكل طبيعي فلا شيء يشي بالمشكلة.

### 1.2 Database

- PostgreSQL 16، عبر `pg.Pool` في [db.js](server/database/db.js). لا ORM — SQL نصي مع `$1` placeholders.
- **ثلاث آليات schema متوازية:**
  1. `server/database/schema.sql` — الأساس، `CREATE TABLE IF NOT EXISTS`.
  2. `server/database/migrations/YYYY-MM-DD-*.sql` — ملفات مؤرَّخة.
  3. **دوال `ensureXSchema()` idempotent** تُستدعى من `bootstrapStartup()` عند كل إقلاع — وهذه هي الآلية الفعلية المستخدمة لكل ميزة حديثة.
- اصطلاح الجداول: `BIGSERIAL PRIMARY KEY`, `tenant_id BIGINT NOT NULL`, `created_at/updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`.

> ⚠️ **`bootstrapStartup()` عند أي خطأ يُنفّذ `process.exit(1)`.** أي `ensureSurveillanceSchema()` يفشل = crash-loop للـbackend كله. يجب أن يكون DDL فقط، idempotent، وبلا backfill يمكن أن يصطدم بـduplicate key.

### 1.3 Authentication

[authMiddleware.js](server/middleware/authMiddleware.js) — JWT Bearer:
- يفكّ التوكن بـ`JWT_SECRET`، يقرأ صف `users` كاملًا، يدمجه في `req.user`.
- يضبط `req.tenantId` و `req.tenant`.
- **لا يوجد re-authentication / step-up auth** في النظام حاليًا (لا تأكيد بكلمة المرور لأي عملية).

### 1.4 Roles & Permissions

**Backend** — [permissionMiddleware.js](server/middleware/permissionMiddleware.js) (653 سطر):
- `permit(module, action)` → جداول `permissions` + `role_permissions` + `roles`.
- الصلاحيات تُزرع بـ`ensureCorePermissions()` من مصفوفة `CORE_PERMISSIONS` ثابتة داخل الملف.
- **ثلاثة مسارات تجاوز (bypass):**
  ```js
  if (isAdmin || isSuperAdmin || hasWildcard) return next();
  ```
  حيث `isAdmin` = اسم الدور نصًّا يساوي `admin` / `super admin` / `superadmin`.

**Frontend** — [rbacStore.js](src/modules/permissions/lib/rbacStore.js) (651 سطر):
- `MODULES` + `MODULE_ACTIONS` + `SIDEBAR_SECTIONS` (مع `permission`, `adminOnly`, `devOnly`).
- [ProtectedRoute.jsx](src/shared/auth/ProtectedRoute.jsx): `isAdminUser()` **يتجاوز كل شيء** قبل فحص الصلاحيات.

> ⚠️ للمطلب #22 (Device Management لصاحب النظام فقط): الـ`admin` الحالي يمر تلقائيًا من كل بوابة. لا يكفي إضافة permission — يجب استخدام بوابة `is_super_admin` صريحة لا تمر عبر `permit()` وحده.

### 1.5 Multi-Tenancy

- جدول `tenants`، و`tenant_id BIGINT NOT NULL REFERENCES tenants(id)` على كل جدول تشغيلي تقريبًا.
- `getTenantId(req)` في [requestScope.js](server/utils/requestScope.js).

> 🔴 **ثغرة حرجة للـSurveillance:** `getTenantId` يقرأ بهذا الترتيب:
> ```
> req.tenantId → req.tenant.id → req.user.tenant_id → x-tenant-id header
>   → query.tenant_id → body.tenant_id → fallback
> ```
> السلسلة تبدأ بمصادر موثوقة، لكن لو كان `req.user.tenant_id` فارغًا (وهو ممكن) فإنها **تسقط إلى header/query/body يتحكم فيهما العميل**. هذا مقبول نسبيًا لبيانات المنتجات؛ وهو **غير مقبول إطلاقًا** لبوابة تفتح تدفق كاميرات وتخزّن كلمات مرور DVR.
> ➜ Surveillance سيستخدم resolver خاص: `requireServerTenant(req)` يقرأ من `req.user.tenant_id` **فقط**، ويرفض بـ400 لو غاب.

### 1.6 Branches

`branches` (id, tenant_id, name, code, phone, address, manager, default_warehouse_id, is_active, lat/lng, …). يوجد `singleBranchMode.js` لوضع الفرع الواحد. **لا يوجد جدول `user_branches`** — لا يوجد حاليًا نموذج "المستخدم يرى فرعًا دون آخر"؛ الفلترة بالفرع تتم غالبًا بالـquery لا بالصلاحية.

### 1.7 Realtime (WebSocket)

- **socket.io v4** على نفس HTTP server ([server.js:266](server/server.js)).
- مصادقة الـhandshake بثلاثة أنواع توكن (ERP / employee portal / manager portal).
- Rooms قائمة بالفعل: `tenant:<id>`، `branch:<id>`، `user:<id>`، `role:<name>`.
- Helper: `emitToRooms(rooms, event, payload)` في [socket.js](server/utils/socket.js).
- nginx يمرّر `/socket.io/` مع upgrade headers.

✅ **قابل لإعادة الاستخدام مباشرة** لأحداث حالة الجهاز/القناة. لا حاجة لـSSE منفصل.

### 1.8 Deployment & Reverse Proxy

- **Local**: `docker-compose.yml` → `db` (postgres:16-alpine) + `backend` + `frontend` (nginx).
- **Production**: Backend على VPS عبر `/opt/erp/deploy-production.sh` (SSH root)، Frontend على **Vercel**، الـAPI على `api.m1store-egy.com`.
- nginx: [default.conf](nginx/default.conf) — يمرّر `/api/` و `/socket.io/` و `/shop/product/`.

> 🔴 **القيد المعماري الأهم في المشروع كله:** الـbackend يعمل على VPS في الإنترنت. الـDVR على شبكة المحل المحلية خلف راوتر منزلي، ومضاف على DMSS بـP2P. **لا يوجد اليوم أي مسار شبكي من الـVPS إلى `192.168.x.x` الخاصة بالمحل.** أي كود adapter مهما كان صحيحًا سيصطدم بـ`ETIMEDOUT`. حل الوصول ليس تفصيلة لاحقة — هو Phase 0.

### 1.9 Redis

اختياري. [cacheService.js](server/services/cacheService.js): `REDIS_URL` / `CACHE_REDIS_URL`، وإن غاب يسقط تلقائيًا إلى in-memory Map. **لا يجب افتراض وجود Redis** — لكن يجب أن يستفيد النظام منه إن وُجد (خصوصًا cache حالة الجهاز).

### 1.10 Secrets at Rest

يوجد نمط ناضج ومُختبَر: [tiktokBusinessCryptoService.js](server/services/tiktokBusinessCryptoService.js)
- AES-256-GCM، envelope بادئة `tkb:v1`، IV 12 بايت، auth tag.
- **مفتاح مخصّص بلا أي fallback** إلى `JWT_SECRET` أو غيره.
- Domain separation: البادئة تُخلط في اشتقاق المفتاح.
- فحص قوة المفتاح (طول، تنوّع أحرف، أنماط placeholder).
- **Dormant عند التعطيل**: لا شيء يعمل وقت الاستيراد، ولا يرمي خطأ إلا عند أول استخدام فعلي.

✅ سيُنسَخ هذا النمط حرفيًا بـ envelope `srv:v1` ومفتاح `SURVEILLANCE_ENCRYPTION_KEY`.

### 1.11 Audit Logs

- `audit_logs` (tenant_id, user_id, action, entity_type, entity_id, **details JSONB**, ip_address INET, user_agent, created_at) — الأنسب.
- `activity_logs` عبر [logActivity.js](server/utils/logActivity.js) — أبسط وبلا tenant_id.

`audit_logs` يغطي مطلب #23 بالكامل تقريبًا: `details` JSONB يحمل `{ old_value, new_value, success, error_code }`. الناقص: `branch_id` و `device_id` — سيُضافان كـ`ADD COLUMN IF NOT EXISTS`… **لا.** إضافة أعمدة لجدول مشترك تخلط النطاقات. سيُستخدم جدول مخصّص `surveillance_audit_logs` بنفس الأعمدة + `device_id`/`channel_id`/`branch_id`، مع الاحتفاظ بكتابة مزدوجة في `audit_logs` للعمليات عالية الخطورة فقط.

### 1.12 Rate Limiting

**لا يوجد middleware مشترك.** كل مسار يبني bucket في الذاكرة بنفسه (`aiSupport.js:129`, `storefront.js:132`, `managerPortal.js:595`). سيُبنى `surveillanceRateLimit` كـmiddleware قابل لإعادة الاستخدام (وهو أول middleware rate-limit عام في المشروع).

### 1.13 Media Infrastructure

```
grep -rln "ffmpeg|rtsp|onvif" server/ src/   →   (لا نتائج)
```
**greenfield تمامًا.** لا ffmpeg، لا WebRTC، لا مشغّل فيديو. كل شيء يُبنى من الصفر.

### 1.14 Frontend

- React 19، Vite 8، react-router 7، lazy routes في [App.jsx](src/App.jsx) (1,701 سطر).
- Design system **M1**: `src/shared/ui/M1UI.jsx` + `m1-ui.css` + `m1-table.css`، CSS variables (`--bg`, `--surface`, `--text`, `--border`, `--muted`, `--primary-soft`, `--shadow`)، theme dark/light عبر `src/theme`.
- i18n: **namespace واحد اسمه `translation`** — المفاتيح دائمًا `t("branch.key")` بنقطة، والنقطتان `:` تُنتج مفتاحًا خامًا صامتًا. أي bundle جديد يجب تسجيله في [localeManifest.js](src/i18n/localeManifest.js) **و** `i18n.js`، وإلا مرّ من كل الحُرّاس وغاب عن البناء.
- API client موحّد: `src/shared/api/api.js` (يحقن التوكن، ويطلق `erp:auth-expired`).

---

## 2. Proposed Architecture

### 2.1 المبدأ الحاكم: فصل ثلاثي

معظم أنظمة المراقبة تفشل في القابلية للبيع لأنها تخلط "أي شركة" بـ"أين الجهاز". هنا **ثلاثة محاور مستقلة**:

```
             ┌──────────────────────────────────────────┐
             │  Surveillance Core (business logic)      │
             │  devices • channels • capabilities       │
             │  permissions • audit • health            │
             └────────┬─────────────────────┬───────────┘
                      │                     │
        ┌─────────────▼──────────┐   ┌──────▼──────────────────┐
        │ SurveillanceProvider   │   │  DeviceTransport        │
        │ (الشركة / البروتوكول)   │   │  (كيف نصل للجهاز)       │
        ├────────────────────────┤   ├─────────────────────────┤
        │ DahuaAdapter           │   │ DirectTransport (LAN/VPN)│
        │ HikvisionAdapter       │   │ TunnelTransport (WireGuard)
        │ UniviewAdapter         │   │ AgentTransport (Edge Agent)
        │ OnvifAdapter           │   └─────────────────────────┘
        │ GenericRtspAdapter     │
        └────────────────────────┘
                      │
             ┌────────▼───────────────┐
             │  MediaGateway          │
             │  RTSP → WebRTC / HLS   │
             └────────────────────────┘
```

**لماذا `DeviceTransport` منفصل عن `Provider`:** لأنه بدونه، أول عميل SaaS يجبرك على إعادة كتابة كل adapter. `DahuaAdapter` يقول "أرسل `GET /cgi-bin/magicBox.cgi?action=getDeviceType` مع Digest auth"؛ الـtransport يقرر إن كان ذلك عبر socket مباشر، أو عبر نفق WireGuard، أو عبر RPC إلى agent في المحل. الـadapter لا يعرف ولا يهتم.

### 2.2 واجهة `SurveillanceProvider`

```js
// كل دالة إما تُنفَّذ أو ترمي UnsupportedCapabilityError — لا stubs صامتة
class SurveillanceProvider {
  static vendorKey;                 // "dahua"
  static displayName;

  async testConnection()            // → { ok, latencyMs, authMethod }
  async getDeviceInfo()             // → { model, firmware, serial, deviceType, channelCount }
  async getCapabilities()           // → CapabilitySet  (مُكتشَفة، لا مُفترَضة)

  async getChannels()               // → [{ index, vendorName, enabled, ptz, resolution }]
  async getChannelStatus(idx)       // → { online, recording, signalLost }

  buildStreamSource(idx, { stream })// → { url, transport, codecHint }   ← لا يُعاد للمتصفح أبدًا
  async getSnapshot(idx)            // → Buffer

  async searchRecordings(idx, from, to)
  buildPlaybackSource(idx, from, to)

  async getStorageInfo()
  async getRecordingConfig() / updateRecordingConfig()
  async getEncoderConfig(idx) / updateEncoderConfig(idx, cfg)
  async getMotionConfig(idx) / updateMotionConfig(idx, cfg)
  async getNetworkInfo()
  async getSystemTime() / updateSystemTime()
  async ptzControl(idx, cmd)
  async restartDevice()
}
```

**قاعدة صارمة:** الـ`Core` لا يستدعي أي دالة إلا بعد التحقق من الـcapability المقابلة، والـUI لا يعرض الزر إلا إذا كانت الـcapability مفعّلة. ثلاث طبقات لنفس القرار (UI → API → Adapter) لأن الطبقتين الأوليين قابلتان للتجاوز.

### 2.3 Capability Detection — النموذج

الـcapabilities **مُكتشَفة ومُخزَّنة، لا مكتوبة يدويًا**:

```
probe()  →  الـadapter يجرّب endpoints حقيقية على الجهاز
         →  يصنّف كل capability إلى: supported | unsupported | unknown
         →  تُخزَّن في surveillance_device_capabilities مع probed_at
         →  تُعاد المحاولة عند: إضافة الجهاز، تغيّر الـfirmware، أو طلب يدوي
```

`unknown` ≠ `supported`. الـUI يخفي `unknown` تمامًا في النسخة الأولى (مطلب #5: لا fake controls). لاحقًا يمكن عرضها كـ"جرّب" خلف علم.

CapabilitySet المعتمد (JSONB):
```json
{
  "liveView": true, "playback": true, "snapshot": true,
  "ptz": false, "audio": false, "twoWayAudio": false,
  "recordingSettings": true, "encoderSettings": true, "motionDetection": true,
  "storageInfo": true, "storageManagement": false,
  "deviceRestart": true, "networkSettings": "read-only",
  "timeSettings": true, "cameraConfiguration": true
}
```
`"read-only"` قيمة صالحة — تُظهر البيانات وتخفي زر التعديل.

### 2.4 Remote Access — القرار

ثلاثة خيارات، والتوصية واضحة:

| الخيار | المزايا | العيوب | الحكم |
|---|---|---|---|
| Port forwarding للـDVR | صفر بنية تحتية | يعرّض واجهة إدارة DVR للإنترنت. أجهزة Dahua/Hikvision لها تاريخ CVEs حرج. مرفوض بنص المطلب #17 | ❌ |
| **WireGuard site-to-site** | نفق مشفّر، الـVPS يرى `192.168.1.108` كأنه محلي، صفر كود، صفر أدوات إدارة جديدة، يعمل خلف CGNAT (الـVPS هو الـserver والمحل هو الـclient) | يحتاج جهازًا دائم التشغيل في المحل (Mini PC / راوتر يدعم WG / Raspberry Pi) | ✅ **للنسخة الأولى** |
| Edge Agent | لا يحتاج تعديل شبكة العميل، يصلح لأي عدد عملاء، ويستضيف الـmedia gateway محليًا فيوفّر bandwidth ضخمًا | كود جديد كبير: agent + registry + outbound tunnel + تحديثات | 🔜 **Phase 6 (SaaS)** |

**الخطة:** WireGuard الآن، مع `AgentTransport` كنقطة توسعة معرّفة من اليوم الأول. لأن `DeviceTransport` مجرّد، الانتقال لاحقًا = تنفيذ class واحد + تغيير عمود `transport_type` في صف الجهاز. لا يُلمس أي adapter ولا أي API ولا أي شاشة.

```
[Browser] ──HTTPS──> [Vercel/nginx] ──> [ERP Backend @ VPS]
                                             │
                                             ├── wg0 (10.20.0.0/24) ──┐
                                             │                        │
                                        [MediaMTX sidecar]            │
                                                                      ▼
                                                          [WireGuard peer @ المحل]
                                                                      │
                                                              LAN 192.168.1.0/24
                                                                      │
                                                          [Dahua XVR 192.168.1.x]
```

### 2.5 Media Gateway — القرار

**الاستنتاج:** لا نبني إدارة عمليات ffmpeg يدويًا. نستخدم **MediaMTX** (Go binary واحد، صورة Docker رسمية) كـsidecar:

- `RTSP in → WebRTC (WHEP) out` — زمن تأخير < 500ms، وهو المطلوب في #7.
- **بلا transcoding** طالما الكوديك H.264 — remux فقط. CPU شبه صفر.
- **إدارة دورة الحياة مبنية داخله**: `runOnDemand` + `runOnDemandCloseAfter: 10s` = بالضبط سلوك "مشاهد يدخل → يبدأ / لا مشاهدين → ينتهي بعد مهلة" المطلوب في #32، بلا كود عمليات نكتبه ونصونه.
- HLS كـfallback تلقائي للمتصفحات/الشبكات التي تفشل فيها WebRTC.

**H.265:** الـXVR1B-I قد يسجّل H.265 على الـmain stream. أغلب المتصفحات لا تفك H.265 عبر WebRTC. الحل: **الـsub-stream يُجبَر على H.264** من إعدادات الجهاز (وهو ما نريده أصلًا للـgrid)، والـmain stream يُفحص كوديكه عند الـprobe؛ إن كان H.265 يُعرض للمستخدم خيار "جودة عالية (يتطلب تحويل)" **معطّلًا افتراضيًا** مع transcoding اختياري خلف علم — لأن تحويل 16 قناة سيقتل الـVPS.

**استراتيجية الجودة** (مطلب #31):
| السياق | التدفق |
|---|---|
| Grid 4/8/9/16 | Sub stream إجباري |
| Grid 1 | Main stream |
| Full screen | Main stream |
| علامة تبويب مخفية | إيقاف كل التدفقات (Page Visibility API) |

**أمان التدفق — كيف لا يرى المتصفح كلمة السر:**
1. المتصفح يطلب `POST /api/surveillance/channels/:id/live` مع `{ stream: "sub" }`.
2. الـbackend يتحقق: tenant + branch + `surveillance.live` + capability + أن الجهاز online.
3. يضمن وجود مسار في MediaMTX باسم مبهم `t{tenant}_d{device}_c{ch}_{sub|main}` مصدره RTSP **بالـcredentials من جانب الخادم فقط**.
4. يصدر **ticket قصير الأجل** (JWT، 60 ثانية، مرتبط بـuser+tenant+channel، أحادي الاستخدام).
5. يعيد `{ whepUrl, ticket }`.
6. المتصفح يطلب WHEP من MediaMTX بالـticket. MediaMTX يستدعي **HTTP auth hook** → `/api/internal/surveillance/media-auth` → الـbackend يتحقق ويردّ 200/403.

النتيجة: لا RTSP URL، لا IP، لا credential يصل للمتصفح أبدًا. الـticket وحده، وهو عديم القيمة بعد دقيقة.

### 2.6 SSRF Model

المستخدم يُدخل IP للـDVR ⇒ الـconnector هو سلاح SSRF بامتياز. القاعدة المعتادة "امنع الـprivate IPs" **معكوسة** هنا لأن الأجهزة نفسها private. لذلك deny-list دقيقة + شروط إضافية:

| القاعدة | التفصيل |
|---|---|
| Deny loopback | `127.0.0.0/8`, `::1` |
| Deny link-local | `169.254.0.0/16` — يشمل `169.254.169.254` (cloud metadata) و `fd00:ec2::254` |
| Deny الـVPS نفسه | عناوينه العامة والخاصة، تُقرأ من الإعداد |
| Deny شبكة Docker | `172.17.0.0/16` وشبكة الـcompose |
| Deny المنافذ الحساسة | 5432 (PG), 6379 (Redis), 8000 (backend), 22, 25, 3306 |
| Allow المنافذ فقط | 80, 443, 554 (RTSP), 37777 (Dahua), 8000-8899 (قابل للتوسيع بإعداد) |
| DNS rebinding | نحلّ الاسم، **نتحقق من الـIP الناتج**، ثم **نتصل بالـIP المُثبَّت** لا بالاسم |
| Redirects | ممنوعة تمامًا (`maxRedirects: 0`) |
| Timeouts | connect 4s، total 10s، لكل طلب |
| Subnet allowlist | لكل tenant، اختياري: نطاقات مسموح بها صراحةً (إلزامي في وضع SaaS) |

النطاقات الخاصة (`192.168/16`, `10/8`, `172.16/12`) **مسموحة** لكن فقط ضمن نطاق النفق المخصّص للـtenant — وهذا هو الضامن الحقيقي: `10.20.<tenant>.0/24`.

### 2.7 Permissions Model

الصلاحيات المطلوبة في #21 تُضاف كـ`(module, action)` وفق الاصطلاح القائم:

| Module | Actions |
|---|---|
| `surveillance` | `view`, `live`, `playback`, `snapshot`, `ptz` |
| `surveillance.device` | `view`, `settings`, `restart` |
| `surveillance.recording` | `settings` |
| `surveillance.storage` | `view`, `manage` |
| `surveillance.network` | `view`, `manage` |
| `surveillance.admin` | `manage` |

**deny-by-default مطلق**: لا backfill لأي دور قائم، ولا حتى لـ`admin`. (سابقة موجودة في الكود: `reports.cost` / `reports.profit` تُركت عمدًا بلا backfill — نفس المنطق ينطبق هنا وبقوة أكبر.)

**مشكلة تجاوز الـadmin** (مطلب #22): `permit()` يمرّر أي دور اسمه `admin` بلا فحص. لذلك:
- إضافة/تعديل/حذف جهاز، وعرض الـcredentials، وتغيير الشبكة، وإعادة التشغيل ⇒ خلف middleware **جديد** `requireSurveillanceOwner` يفحص `is_super_admin` مباشرةً ولا يستشير `permit()` إطلاقًا.
- بقية العمليات (live/playback/ptz) عبر `permit()` المعتاد.

**عزل الفروع** (#20): لا يوجد `user_branches` في النظام. سنضيف `surveillance_user_branch_access` **محصورًا بهذا النطاق** — أضيق من تعديل نموذج المستخدمين العام، ويحل المشكلة دون لمس شيء قائم. غيابه = المستخدم يرى كل فروع الـtenant الخاص به (السلوك الحالي في بقية النظام).

---

## 3. الملفات والجداول والـServices

### 3.1 جداول جديدة (7)

كلها بالاصطلاح القائم: `BIGSERIAL PK`, `tenant_id BIGINT NOT NULL`, timestamps.

```sql
surveillance_devices
  id, tenant_id, branch_id, name, vendor_key, transport_type,
  host, port, protocol, model, firmware, serial_hash, channel_count,
  status ('online'|'offline'|'unauthorized'|'unknown'), last_seen_at,
  last_error_code, is_active, created_by, updated_by, created_at, updated_at
  UNIQUE (tenant_id, host, port)

surveillance_device_credentials          -- مفصول عمدًا: صلاحيات SELECT مختلفة
  id, tenant_id, device_id UNIQUE, username,
  password_encrypted TEXT,               -- envelope "srv:v1", AES-256-GCM
  auth_method, rotated_at, created_at, updated_at

surveillance_device_capabilities
  id, tenant_id, device_id UNIQUE, capabilities JSONB,
  probe_status, probe_error, probed_at, firmware_at_probe

surveillance_channels
  id, tenant_id, device_id, channel_index,
  display_name,                          -- الاسم داخل ERP (مطلب #9)
  vendor_name,                           -- الاسم داخل الجهاز
  is_enabled, ptz_supported, audio_supported,
  main_codec, sub_codec, status, last_seen_at, created_at, updated_at
  UNIQUE (device_id, channel_index)

surveillance_user_layouts
  id, tenant_id, user_id, name, layout ('1'|'4'|'8'|'9'|'16'),
  slots JSONB, is_default, created_at, updated_at

surveillance_audit_logs
  id, tenant_id, branch_id, device_id, channel_id, user_id,
  action, old_value JSONB, new_value JSONB,
  success BOOLEAN, error_code, ip_address INET, user_agent,
  created_at
  INDEX (tenant_id, device_id, created_at DESC)

surveillance_user_branch_access
  id, tenant_id, user_id, branch_id, created_at
  UNIQUE (tenant_id, user_id, branch_id)
```

**ملاحظات تصميمية:**
- `serial_hash` لا `serial`: الرقم التسلسلي معرّف قابل للاستغلال في P2P clouds. نحتاجه فقط لكشف "هل هذا نفس الجهاز؟" ⇒ hash يكفي.
- الـcredentials في جدول منفصل حتى لا يسرّبها أي `SELECT *` على `surveillance_devices` — وهو خطأ يحدث حرفيًا في كل مشروع.
- لا عمود `password` عادي في أي مكان. أبدًا.

### 3.2 ملفات backend جديدة

```
server/routes/surveillance.js                       ← يُركَّب على /api/surveillance
server/middleware/surveillanceGuards.js             ← requireSurveillanceOwner, requireCapability,
                                                      requireBranchAccess, surveillanceRateLimit
server/services/surveillance/
  surveillanceSchema.js         ensureSurveillanceSchema()  ← DDL فقط
  surveillanceDeviceService.js  CRUD + probe + import channels
  surveillanceCredentialService.js  encrypt/decrypt + rotate
  surveillanceCryptoService.js  envelope "srv:v1"   ← منسوخ من نمط tiktokBusiness
  surveillanceAuditService.js   كتابة موحّدة + redaction
  surveillanceHealthService.js  polling مُهدَّأ + cache
  surveillanceMediaService.js   MediaMTX paths + tickets
  surveillanceNetworkGuard.js   SSRF validation + IP pinning
  transports/
    DeviceTransport.js          (abstract)
    DirectTransport.js
    TunnelTransport.js
    AgentTransport.js           (stub معرّف، غير مُنفَّذ)
  providers/
    SurveillanceProvider.js     (abstract + UnsupportedCapabilityError)
    providerRegistry.js
    dahua/DahuaAdapter.js
    dahua/dahuaCgi.js           Digest auth client
    dahua/dahuaCapabilities.js  probe
    generic/GenericRtspAdapter.js
```

> ⚠️ **إلزامي**: إضافة `!server/services/surveillance/` و `!server/services/surveillance/**` إلى `.gitignore` في **كلا الكتلتين** (السطور ~41 و ~82)، وإلا لن يُنشر أي شيء.

### 3.3 ملفات backend مُعدَّلة (5 فقط)

| الملف | التعديل |
|---|---|
| `server/server.js` | سطر import + `app.use("/api/surveillance", ...)` + `await ensureSurveillanceSchema(db)` داخل `bootstrapStartup` |
| `server/middleware/permissionMiddleware.js` | إضافة صفوف `surveillance.*` إلى `CORE_PERMISSIONS` **بلا** إضافتها لكتلة backfill الـadmin |
| `.gitignore` | استثناءات `!` للمجلد الجديد (كلا الكتلتين) |
| `.env.example` | `SURVEILLANCE_ENABLED`, `SURVEILLANCE_ENCRYPTION_KEY`, `SURVEILLANCE_MEDIA_URL`, `SURVEILLANCE_MEDIA_TOKEN`, `SURVEILLANCE_ALLOWED_SUBNETS` |
| `docker-compose.yml` | خدمة `mediamtx` (لا تُنشر إلا مع `SURVEILLANCE_ENABLED`) |

### 3.4 ملفات frontend جديدة

```
src/modules/surveillance/
  pages/SurveillanceLive.jsx          Live grid 1/4/8/9/16
  pages/SurveillancePlayback.jsx      Playback Center
  pages/SurveillanceDevices.jsx       قائمة الأجهزة  (super admin)
  pages/SurveillanceDeviceSettings.jsx إعدادات الجهاز (super admin)
  components/AddDeviceWizard.jsx      5 خطوات
  components/CameraTile.jsx           WebRTC player + حالات
  components/PtzPanel.jsx
  components/CapabilityGate.jsx       لا يعرض إلا المدعوم
  components/DangerousActionModal.jsx تأكيد نصي + step-up
  hooks/useWhepPlayer.js              WebRTC + تنظيف صارم
  hooks/useStreamBudget.js            سقف التدفقات المتزامنة
  services/surveillanceApi.js
src/locales/en/surveillance.json      ← اسم فريد، لا يصطدم بأي bundle
src/locales/ar/surveillance.json
```

### 3.5 ملفات frontend مُعدَّلة (4)

| الملف | التعديل |
|---|---|
| `src/App.jsx` | 4 `lazy()` + 4 `<Route>` داخل `ProtectedRoute` |
| `src/modules/permissions/lib/rbacStore.js` | `MODULES` + `MODULE_ACTIONS` + قسم sidebar جديد "Surveillance" |
| `src/i18n/localeManifest.js` | `{ branch: "surveillance", file: "surveillance" }` |
| `src/i18n/i18n.js` | import الـbundles (وإلا لن تظهر في البناء رغم مرور كل الحُرّاس) |

---

## 4. Security Review

### 4.1 المخاطر ومعالجتها

| # | الخطر | الشدة | المعالجة |
|---|---|---|---|
| S1 | تسريب credentials للمتصفح | 🔴 حرجة | الـRTSP URL لا يُبنى إلا في الذاكرة داخل الـservice؛ الـAPI تُعيد ticket فقط؛ اختبار يؤكد أن أي response من `/api/surveillance/*` لا يحوي `password`/`rtsp://`/`@` |
| S2 | SSRF عبر حقل الـhost | 🔴 حرجة | §2.6 — deny-list + منافذ + IP pinning + منع redirects |
| S3 | تجاوز عزل الـtenant | 🔴 حرجة | `requireServerTenant(req)` من `req.user` فقط؛ كل استعلام `WHERE tenant_id = $1`؛ الـmedia auth hook يعيد التحقق من الـtenant |
| S4 | الـmedia gateway مكشوف مباشرةً | 🔴 حرجة | MediaMTX لا يُنشر منفذًا للمضيف؛ داخل شبكة Docker فقط؛ يُوصَل عبر nginx بمسار محمي؛ auth hook إلزامي |
| S5 | credentials بنص صريح في DB | 🔴 حرجة | AES-256-GCM، مفتاح مخصّص بلا fallback، envelope `srv:v1` |
| S6 | تسريب في الـlogs | 🟠 عالية | `redactSurveillance()` مركزية تُطبَّق على كل log/error؛ منع `console.log(error)` الخام في هذا النطاق؛ اختبار على نص الـlog |
| S7 | عملية خطرة بضغطة واحدة | 🟠 عالية | Modal + كتابة كلمة تأكيد + step-up (إعادة إدخال كلمة مرور ERP) للـrestart/network/format |
| S8 | Flooding للأوامر | 🟠 عالية | rate limit: restart 1/10د/جهاز، network 3/ساعة، PTZ 10/ث مع دمج، probe 6/دقيقة |
| S9 | تجاوز الـadmin للحدود | 🟠 عالية | `requireSurveillanceOwner` يفحص `is_super_admin` ولا يستشير `permit()` |
| S10 | استنزاف موارد الـVPS | 🟡 متوسطة | سقف تدفقات لكل tenant ولكل مستخدم؛ sub-stream إجباري في الـgrid؛ `runOnDemandCloseAfter` |
| S11 | صلاحيات زائدة على الـDVR | 🟡 متوسطة | إنشاء حساب `erp_surveillance` بأقل صلاحيات؛ الـwizard يحذّر إذا كان المستخدم `admin`؛ توثيق الحد الأدنى المطلوب لكل capability |
| S12 | فقدان المفتاح ⇒ فقدان كل الأجهزة | 🟡 متوسطة | فشل decrypt يُظهر "أعد إدخال بيانات الاعتماد" لا 500؛ المفتاح موثّق في runbook النشر |

### 4.2 Step-up Authentication — إضافة جديدة على النظام

لا يوجد step-up حاليًا. سيُضاف نقطة واحدة صغيرة:
```
POST /api/auth/verify-password  → { ok: true, stepUpToken }   (صالح 5 دقائق)
```
تُطلب من العمليات فئة "خطرة جدًا" فقط. هذه إضافة على `auth.js` — أصغر وأنظف من بناء نظام إعادة مصادقة كامل، وقابلة لإعادة الاستخدام لاحقًا (حذف tenant، factory reset…).

### 4.3 Principle of Least Privilege على الـDVR

سيوثَّق في runbook: أنشئ في الـXVR مستخدمًا `erp_surveillance` بصلاحيات المشاهدة/التشغيل/PTZ فقط. الوظائف الإدارية (restart، تعديل encoder) تحتاج صلاحية أعلى ⇒ **بيانات اعتماد اختيارية منفصلة** بحقل `admin_credentials` مستقل، لا تُخزَّن إلا إذا اختار المالك تفعيل تلك الوظائف. الافتراضي: النظام يعمل بحساب محدود الصلاحيات، والوظائف الإدارية تظهر معطّلة مع تفسير واضح.

---

## 5. Implementation Plan

كل مرحلة **قابلة للنشر بمفردها**، والنظام كله خلف `SURVEILLANCE_ENABLED=false` حتى Phase 4. أي مرحلة لا تكسر شيئًا قائمًا.

### Phase 0 — Network Path *(قبل أي كود)*
لا كود. تجهيز WireGuard: server على الـVPS، peer في المحل، تأكيد `ping` و `curl` من الـVPS إلى IP الـXVR.
**بوابة القبول:** `curl -u ... http://<dvr-ip>/cgi-bin/magicBox.cgi?action=getSystemInfo` من الـVPS يعيد ردًا.
> بدون هذه المرحلة، كل ما بعدها غير قابل للاختبار على جهاز حقيقي.

### Phase 1 — Foundation *(بلا واجهة)*
Schema + crypto service + network guard + الصلاحيات + audit service + الحُرّاس + هيكل `SurveillanceProvider`/`DeviceTransport` + registry فارغ.
`ensureSurveillanceSchema` في `bootstrapStartup` — DDL فقط، لا backfill.
**القبول:** الـbackend يقلع طبيعيًا، الجداول موجودة، اختبارات crypto وSSRF تمر، صفر تغيير سلوكي.

### Phase 2 — Dahua Adapter + Device Management
`DahuaAdapter` (Digest CGI) + `DirectTransport` + `TunnelTransport` + probe + import channels + `/api/surveillance/devices*` + شاشة الأجهزة + Add Device Wizard (5 خطوات).
**القبول:** إضافة الـXVR الحقيقي، اكتشاف الموديل والـfirmware و16 قناة، عرض capabilities حقيقية.
> هنا نكتشف فعليًا ما يدعمه `DH-XVR1B16-I`. الـcapabilities تُبنى من نتيجة الـprobe لا من الوثائق.

### Phase 3 — Media Gateway + Live View
MediaMTX sidecar + ticket auth + `useWhepPlayer` + Live grid بكل الـlayouts + snapshot + full screen + main/sub + تنظيف صارم.
**القبول:** 16 قناة sub-stream في grid واحد، تبديل الـfull screen إلى main، صفر عملية/socket معلّقة بعد الخروج (يُتحقَّق منه بالقياس).

### Phase 4 — Playback + PTZ + Health *(أول تفعيل للعلم)*
بحث تسجيلات + مشغّل playback بـseek + PTZ (إن كشف الـprobe دعمه) + مراقبة صحة الجهاز مع cache + أحداث socket.io.
**القبول:** تشغيل تسجيل من أمس، والحالة تتحدث لحظيًا. `SURVEILLANCE_ENABLED=true` لـsuper admin فقط.

### Phase 5 — Device Settings + Dangerous Actions
Encoder / Recording / Motion / Time / Storage / Network (قراءة) + step-up auth + كل الـmodals + audit كامل مع old→new.
**القبول:** تغيير bitrate لقناة يُسجَّل كـ`2048 → 4096` مع المستخدم والوقت والـIP.

### Phase 6 — Multi-Vendor + SaaS *(لاحقًا)*
`OnvifAdapter`, `HikvisionAdapter`, `AgentTransport` + Edge Agent.
لا يتطلب أي تعديل على Phases 1-5 — وهذا هو اختبار صحة المعمارية.

---

## Open Questions

هذه لا تمنع البدء (Phase 1 مستقل عنها تمامًا) لكن يلزم حسمها قبل Phase 2/3:

1. **جهاز WireGuard في المحل** — هل يوجد Mini PC / جهاز دائم التشغيل، أم يجب شراء واحد؟
2. **حساب الـDVR** — هل يمكن إنشاء `erp_surveillance` على الـXVR، أم سنبدأ بحساب موجود؟
3. **موارد الـVPS** — كم vCPU/RAM متاح؟ يحدد سقف التدفقات المتزامنة.
4. **الفروع** — كم فرعًا فعليًا الآن؟ (يحدد ما إذا كان `surveillance_user_branch_access` مطلوبًا في Phase 2 أم يؤجَّل.)
