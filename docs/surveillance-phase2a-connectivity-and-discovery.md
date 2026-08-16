# Phase 2A — Connectivity & Dahua Discovery

> **الحالة: بحث وتحقق فقط. لم يُكتب أي كود، ولم يُلمس أي جهاز.**
> Branch: `feature/surveillance-phase2` · Base SHA: `c02119b`
> التاريخ: 17 أغسطس 2026

---

## 0. ما تم فحصه فعليًا

| المصدر | الطريقة |
|---|---|
| بنية شبكة الـVPS | SSH read-only إلى `13.140.141.50` — قراءة فقط، صفر تغيير |
| مواصفات `DH-XVR1B16-I` | صفحة Dahua الرسمية + datasheets رسمية + موزّعون |
| Dahua HTTP API | التوثيق العام + عميل إنتاجي مُستخدم فعليًا (`rroller/dahua`) |
| ONVIF على مسجّلات Dahua | وثائق Dahua Tech الرسمية + DahuaWiki |
| **الجهاز نفسه** | **لم يُلمس. لا اتصال، لا scan.** |

---

## 1. Network Architecture — تحديد الجزء `???`

### الواقع المُقاس على الـVPS

```
=== PUBLIC IP ===          eth0  13.140.141.50/18   (IPv4 واحد فقط، لا IPv6 عام)
=== WIREGUARD ===          NOT installed
=== /dev/net/tun ===       موجود  ⇒ الـkernel يدعم TUN، تثبيت WG ممكن
=== UFW (active) ===       22, 80, 443, 8080, 9000, 9999/tcp   (لا UDP مفتوح إطلاقًا)
=== Docker bridges ===     172.17 · 172.18 · 172.19 · 172.20
                           172.21 · 172.22 · 172.23 · 172.24   ← ثمانية
```

### 🔴 ثغرة في حارس Phase 1 اكتُشفت من هذا الفحص

`infrastructureDenyRanges()` في [surveillanceNetworkGuard.js](../server/services/surveillance/surveillanceNetworkGuard.js) يمنع افتراضيًا `172.17`–`172.20` فقط. الـVPS يشغّل **ثمانية** جسور Docker تمتد إلى `172.24`. النطاقات الأربعة الأخيرة غير مغطاة بالافتراضي.

الاستغلال ليس تلقائيًا — النطاقات الخاصة ممنوعة أصلًا ما لم يمنحها المالك في `surveillance_network_grants`. لكن عميلًا شبكته `172.21.x` (وارد) لو مُنح ذلك النطاق، لصار قادرًا على الوصول لشبكة Docker. **يجب إصلاحه في 2B**: توسيع الافتراضي إلى `172.16.0.0/12` كاملًا مع استثناء صريح لنطاق العميل.

### الجزء `???` — الوضع الحالي

```
Internet
   │
VPS 13.140.141.50   ← UFW: لا UDP، لا VPN، لا tunnel
   │
   ✗   لا يوجد أي مسار      ← هذا هو الجزء المفقود
   │
Store Router (غير معروف الموديل — مطلوب منك)
   │
Dahua XVR (LAN IP غير معروف — مطلوب منك)
   │
   └── DMSS / P2P → سحابة Dahua → هاتف المالك   ← المسار الوحيد العامل اليوم
```

**الخلاصة: لا يوجد مسار شبكي اليوم، ولا نصف مسار.** ولا يمكن بناؤه من طرف الـVPS وحده — الطرف الناقص داخل المحل.

---

## 2. مقارنة طرق الوصول

| | A · WireGuard على الراوتر | B · Edge Agent | C · جهاز دائم بـWG client | D · Tailscale / نفق مُدار | E · Dahua P2P |
|---|---|---|---|---|---|
| يعمل خلف CGNAT | ✅ (outbound) | ✅ | ✅ | ✅ | ✅ |
| يحتاج فتح port في المحل | ❌ | ❌ | ❌ | ❌ | ❌ |
| يحتاج فتح port على VPS | UDP 51820 | ❌ | UDP 51820 | ❌ | ❌ |
| كود جديد | صفر | **كبير** | صفر | صفر | متوسط |
| يحتاج شراء جهاز | غالبًا (الراوتر) | نعم | نعم | نعم | لا |
| تصادم الـsubnets بين العملاء | 🔴 قاتل | ✅ محلول | 🔴 قاتل | 🟠 جزئي | ✅ |
| تبعية طرف ثالث | لا | لا | لا | **نعم** | **نعم** |
| API رسمي للخوادم | — | — | — | — | **لا يوجد** |

### لماذا Port Forwarding مستبعد تمامًا

ليس تفضيلًا. أجهزة Dahua/Hikvision لها سجل CVEs حرجة قابلة للاستغلال قبل المصادقة، وواجهات إدارة المسجّلات تُفهرَس على Shodan خلال ساعات من تعريضها. تعريض `37777` أو `554` أو واجهة الويب للإنترنت يحوّل جهاز المحل إلى هدف دائم — والمطلب #17 يمنعه صراحةً.

### لماذا E (P2P/DMSS) مرفوض كأساس

- لا يوجد **API رسمي موثّق** من Dahua لتكامل خادم عبر P2P. الموجود SDKs للعميل ومنتجات مثل DSS تفترض شبكة موصولة.
- بناء ERP فوق بروتوكول P2P غير موثّق = بناء فوق شيء يمكن لتحديث firmware أن يكسره بلا إشعار، بلا عقد ولا دعم.
- **يبقى مفيدًا كما هو** لمشاهدة المالك من الهاتف. لا نلغيه، لكنه ليس مسار الـERP.

### 🔴 تصادم الـSubnets — النقطة الحاسمة لـSaaS

هذه هي التي تحسم القرار وليست الأداء ولا الأمان:

```
عميل 1: 192.168.1.0/24     ┐
عميل 2: 192.168.1.0/24     ├── ثلاثتهم على نفس النطاق حرفيًا
عميل 3: 192.168.1.0/24     ┘
```

أي حل **موجَّه** (routed VPN — WireGuard أو غيره) يضع كل هذه النطاقات في جدول توجيه واحد على الـVPS. `192.168.1.108` تصبح عنوانًا غامضًا لثلاثة أجهزة مختلفة لثلاثة عملاء مختلفين. لا يوجد حل نظيف إلا per-tenant network namespaces + NAT مزدوج لكل عميل — أي تعقيد تشغيلي هائل، وطبقة يجب أن تكون صحيحة 100% وإلا **تسرّب فيديو بين العملاء**.

الـAgent يلغي المشكلة من جذرها لأن العنونة تصبح **نسبية للـagent**: الـERP يقول «يا وكيل 47، كلّم 192.168.1.108» والوكيل يحلّها داخل شبكته. لا جدول توجيه عالمي، ولا تصادم، ولا إعداد VPS لكل عميل.

---

## 3. A · التوصية للمحل الحالي

### **MikroTik يعمل كـWireGuard client خلف الراوتر الحالي**

جهاز صغير (hEX / hAP ax lite، فئة 40–60 دولارًا) يُوصَل بمنفذ LAN في راوتر المحل. **لا يستبدل الراوتر ولا يغيّر إعداداته.** يفتح نفق WireGuard صادرًا نحو الـVPS ويوجّه `192.168.1.0/24`.

**لماذا هو الأنسب الآن:**

| | |
|---|---|
| كود جديد | **صفر** — كل شيء موجود من Phase 1؛ 2B يصبح Dahua Adapter فقط |
| تغيير على راوتر المحل | **صفر** — جهاز إضافي على الشبكة لا بديل |
| CGNAT / IP متغير | لا يهم — النفق صادر |
| صيانة | RouterOS مصمَّم للتشغيل المستمر بلا OS يُحدَّث ولا SD card يتلف |
| على الـVPS | فتح **UDP واحد** (51820) + تثبيت `wireguard` |

**البدائل ولماذا لا:** Raspberry Pi (كارت SD يتلف بعد شهور من الكتابة المستمرة — عطل ميداني معروف)، راوتر المحل نفسه (أجهزة ISP في مصر — Huawei/ZTE — لا تدعم WireGuard ولا OpenWrt عادةً)، جهاز POS الموجود (يُطفأ بعد إغلاق المحل، وهو تحديدًا الوقت الذي تريد فيه الكاميرات).

> **مهم**: هذا الحل **لهذا المحل فقط**. لا يُصلح للـSaaS للسبب في §2.

---

## 4. B · التوصية للـSaaS — نعم، الـEdge Agent يجب أن يكون النقل القياسي

**نعم، بوضوح.** ثلاثة أسباب مستقلة، وأولها وحده كافٍ:

1. **تصادم الـsubnets** (§2) — يجعل الـVPN الموجَّه غير قابل للتوسّع أصلًا.
2. **الـbandwidth** — الوكيل يستضيف الـmedia gateway محليًا، فيرسل تدفقًا جاهزًا للويب مرة واحدة بدل أن يعبر RTSP الخام النفق ثم يُعالَج على الـVPS. ويستطيع خدمة مشاهد داخل المحل بلا خروج للإنترنت إطلاقًا.
3. **الحدود الأمنية** — النفق الموجَّه يعطي الـVPS وصولًا لكامل شبكة العميل (طابعات، نقاط بيع، ملفات). الوكيل يعطيه وصولًا لما صُرّح به فقط، وهو ما يمكن قوله للعميل بثقة.

### تصميم الـAgent (تصميم فقط — لن يُنفَّذ قبل موافقتك)

**Responsibilities** — يتصل صادرًا ويبقي القناة؛ ينفّذ أوامر typed من قائمة بيضاء؛ يستضيف media gateway محليًا؛ يحمل بيانات اعتماد الأجهزة محليًا مشفّرة؛ heartbeat؛ اكتشاف أجهزة داخل نطاقات مصرّح بها فقط.
**لا يفعل**: لا ينفّذ كودًا عشوائيًا، لا يمرّر HTTP اعتباطيًا، لا يخزّن تسجيلات، لا يقبل اتصالًا واردًا.

**Authentication** — تسجيل لمرة واحدة برمز قصير الأجل من شاشة الـERP يُبادَل بشهادة عميل mTLS. الشهادة مرتبطة بـ`(tenant_id, branch_id, agent_id)`، عمرها 90 يومًا، تُجدَّد تلقائيًا. **الرمز ليس بيانات اعتماد دائمة** — يُستهلك مرة واحدة.

**Tenant / branch binding** — الـtenant من الشهادة، لا من أي شيء يرسله الوكيل. وكيل الفرع 3 لا يستطيع تنفيذ أمر على جهاز في الفرع 5 حتى لو طُلب منه — يُرفض من الطرفين.

**Device discovery boundaries** — يمسح فقط نطاقات في `surveillance_network_grants` للـtenant. لا يمسح أبدًا نطاقات صاحب الـERP. النتائج **اقتراحات** لا تُنشئ أجهزة — المالك يوافق يدويًا.

**Heartbeat** — كل 30 ثانية بحالة مختصرة. لا رد لدورتين ⇒ `degraded`؛ لأربع ⇒ `offline` وكل التدفقات تُنهى.

**Reconnect** — backoff أُسّي مع jitter، 1s → 5 دقائق سقفًا. لا تخلٍّ نهائي.

**Command channel** — طلب/رد مُعرَّف بالأنواع فوق القناة الدائمة، `command_id` لمنع التكرار، مهلة لكل أمر، والأوامر الخطرة تحمل `audit_id` مُصدَرًا مسبقًا فيرفض الوكيل تنفيذ أمر بلا سجل.

**Media transport** — الوكيل يُشغّل الـgateway محليًا ويسلّم WebRTC. المشاهد داخل المحل يتصل مباشرة عبر LAN؛ من الخارج عبر relay على الـVPS. تذاكر Phase 1 تبقى كما هي بلا تغيير.

**Credential handling** — بيانات اعتماد الجهاز تُسلَّم للوكيل مشفّرة بمفتاح مشتق من شهادته، تُفكّ في الذاكرة فقط، لا تُكتب على القرص أبدًا. سحب الشهادة = البيانات المخزّنة عنده لا تُفكّ.

**Upgrade** — حزم موقّعة، تفعيل ذرّي، رجوع تلقائي إن فشل الـheartbeat بعد الترقية، وترقيات تدريجية.

**Revocation** — إبطال فوري من الـERP؛ الوكيل يفقد القناة والقدرة على فك التشفير معًا. CRL يُفحص عند كل إعادة اتصال.

**Offline behavior** — يستمر في خدمة المشاهدين المحليين إن أمكن، يخزّن الأحداث بحد أقصى مؤقت، **لا ينفّذ أي أمر مؤجَّل عند العودة** (أمر restart صدر قبل ساعتين لا يجوز أن يُنفَّذ الآن). الـERP يعرض الفرع `offline` صراحةً.

---

## 5. C · Architecture Diagram

### اليوم (بعد 2B، المحل الحالي)

```
Browser ──HTTPS──> Vercel ──/api──> ERP Backend @ VPS
                                          │
                            ┌─────────────┼──────────────┐
                            │             │              │
                      Authorization    Audit        MediaGateway
                       tenant+RBAC   (write-ahead)   (MediaMTX)
                            │             │              │
                            └──────> Provider ───> Transport
                                   (DahuaAdapter)  (TunnelTransport)
                                                        │
                                                  wg0 10.20.0.0/24
                                                        │
                                              MikroTik @ المحل
                                                        │
                                                LAN 192.168.1.0/24
                                                        │
                                                  Dahua XVR
```

### مستقبلًا (SaaS)

```
Browser ──HTTPS──> ERP @ Cloud
                        │
                  Authorization · Audit
                        │
                    Provider ──> AgentTransport
                        │
                  mTLS، صادر من الوكيل، لا port وارد
                        │
              ┌─────────▼──────────┐
              │  Edge Agent @ المحل │  ← يستضيف الـmedia gateway
              └─────────┬──────────┘
                        │  LAN العميل
              ┌─────────┼─────────┐
             DVR       NVR    IP Cameras
```

**الفارق الوحيد بين الرسمتين هو صندوق الـTransport.** هذا هو العائد الفعلي على فصل `Provider × Transport` في Phase 1: الانتقال للـSaaS = تنفيذ class واحد.

---

## 6. D · Dahua Capability Matrix — DH-XVR1B16-I

> **قاعدة**: لا شيء هنا يصبح `supported` في الـERP قبل probe حقيقي على الجهاز. حتى `confirmed (spec)` تعني «الوثيقة تقولها» لا «تحققنا منها».

### مواصفات مؤكَّدة من المصادر الرسمية

| البند | القيمة | ملاحظة |
|---|---|---|
| Codecs | AI Coding · H.265+ · H.265 · H.264+ · H.264 | حاسم — انظر §9 |
| Main stream | 1080N / 720p / 960H / D1 / CIF | **1080N ليس 1080p** |
| **Sub stream** | **CIF فقط @ 1–7 fps** | 🔴 قيد جوهري |
| Video bit rate | 32 kbps – 4096/6144 kbps | يختلف بالنسخة |
| NIC | **10/100 Mbps، RJ-45 واحد** | |
| Bandwidth | 64 Mbps وارد / صادر | |
| Protocols | HTTP · HTTPS · TCP/IP · RTSP · UDP · NTP · DHCP · DNS · DDNS · SMTP · P2P | |
| ONVIF | 16.12 (نسخة 2022) / 21.12 (V2.0) | **يحتاج حساب ONVIF منفصل** |
| CGI | Conformant | |
| Max users | 128 | |
| Playback | 1 / 4 / 9 / 16 | |
| PTZ / RS-485 | **غير مذكور — الموزّعون يذكرون غياب PTZ مخصّص** | |

### 🔴 ثلاثة اكتشافات تغيّر التصميم

**1. الـsub stream = CIF @ 1–7 fps.** CIF = 352×288. شبكة 16 كاميرا ستكون 16 مربعًا بحجم طابع بريد وحركة متقطّعة. هذه ليست مشكلة تنفيذ — هذا سقف الجهاز. البدائل الواقعية: شبكة 16 على sub (رخيصة، رديئة) وmain عند التكبير، أو شبكة 4 على main إن سمح رفع الإنترنت.

**2. الجهاز 1080N لا 1080p.** 1080N تقريبًا نصف الدقة الأفقية تُمدَّد للعرض. الجودة القصوى المتاحة أقل مما يوحي «مسجّل 1080».

**3. PTZ شبه مؤكد غير متاح.** لا منفذ RS-485 مذكور، والكاميرات المرجَّحة ثابتة. الـcapability probe سيُرجع `unsupported` ولوحة PTZ لن تُعرض — وهو بالضبط سلوك نموذج الـcapability من Phase 1.

### المصفوفة

| Capability | التصنيف | الأساس | ملاحظة |
|---|---|---|---|
| RTSP live | **confirmed (spec)** | RTSP في البروتوكولات؛ `/cam/realmonitor?channel=N&subtype=0\|1` موثّق | التحقق: عنونة القنوات فعليًا |
| Main stream | **confirmed (spec)** | `subtype=0` | |
| Sub stream | **confirmed (spec)** | `subtype=1` — CIF @1–7fps | القيد مؤكَّد |
| ONVIF | **likely — requires verification** | ONVIF 16.12/21.12 | يحتاج **تفعيل + حساب ONVIF منفصل**؛ احتياطي لا أساسي |
| HTTP/HTTPS mgmt | **confirmed (spec)** | في البروتوكولات | |
| CGI/API | **likely — requires verification** | "CGI Conformant" + عملاء إنتاجيين | مجموعة الـCGI على XVR اقتصادي **قد تكون أضيق** من IPC |
| Digest auth | **likely — requires verification** | العملاء العاملون يستخدمون Digest حصرًا | |
| Device info | **likely** | `magicBox.cgi?action=getSystemInfo` / `getDeviceType` | |
| Firmware | **likely** | `magicBox.cgi?action=getSoftwareVersion` | |
| Snapshot | **likely** | `snapshot.cgi?channel=N` | على XVR للقنوات التماثلية يحتاج تحققًا |
| Recording search | **likely** | `mediaFileFind.cgi` — factory.create → findFile → findNextFile → close → destroy | |
| Playback stream | **likely** | RTSP playback أو `playBack.cgi` | |
| Encoder config | **likely** | `configManager.cgi?action=getConfig&name=Encode` | الكتابة تحتاج تحققًا حذرًا |
| Recording config | **likely** | `name=Record` / `RecordMode` | |
| Motion config | **likely** | `name=MotionDetect` | |
| Storage status | **likely** | `storageDevice.cgi?action=getDeviceAllInfo` | معروف أنه يخطئ على أجهزة بلا تخزين |
| Time / NTP | **likely** | `global.cgi?action=getCurrentTime` · `name=NTP` | |
| Network config قراءة | **likely** | `netApp.cgi?action=getInterfaces` · `name=Network` | |
| Network config كتابة | **unknown — عالي الخطورة** | — | يُعامل `read-only` حتى إثبات المسار الآمن (§12) |
| Restart | **likely** | `magicBox.cgi?action=reboot` | |
| **PTZ** | **likely UNSUPPORTED** | لا RS-485؛ كاميرات ثابتة مرجَّحة | تحقق ثم إخفاء اللوحة |
| Two-way audio | **unknown** | — | |
| Storage mgmt (تهيئة) | **unknown** | — | يبقى `unknown` عمدًا ⇒ مخفي |
| Firmware update | **unsupported (بقرارنا)** | — | خارج نطاق المنتج |

> **تنبيه**: كل توثيق Dahua HTTP API المتاح عمومًا كُتب لكاميرات IP بالأساس. الـXVR الاقتصادي يشترك في معظمه لكنه ليس متطابقًا. الـprobe موجود تحديدًا لهذا.

---

## 7. E · المعلومات المطلوبة منك

**لا ترسل كلمة مرور ولا Serial Number في المحادثة.**

### قبل 2B (تحجب البدء)

| # | المطلوب | لماذا |
|---|---|---|
| 1 | **موديل راوتر المحل** | يحدد هل A ممكن أم نحتاج جهازًا |
| 2 | **سرعة الرفع (upload)** من فحص سرعة داخل المحل | القيد الحقيقي — ليس الـNIC (§9) |
| 3 | هل IP المحل عام أم CGNAT | يؤثر على الخيارات لا على التوصية |
| 4 | **موافقة على شراء جهاز WireGuard** | §13-قرار 1 |
| 5 | **LAN IP للـXVR** ونطاق الشبكة | مثل `192.168.1.108` و`192.168.1.0/24` |

### من واجهة الـXVR (بعد إتاحة المسار — أنت أو أنا)

الموديل الدقيق · نسخة الـfirmware وتاريخ البناء · عدد القنوات النشطة · إعداد main/sub لكل قناة (دقة/fps/bitrate/codec) · هل ONVIF مفعّل وهل يوجد حساب ONVIF · قائمة المستخدمين (**أسماء فقط، بلا كلمات مرور**) · حالة القرص وسعته.

**كل هذا سيقرأه الـprobe تلقائيًا** بمجرد وجود المسار. أرسل يدويًا فقط ما يسبق ذلك.

---

## 8. F + 10 · Media Strategy — مراجعة قرار MediaMTX

### المقارنة

| | MediaMTX | FFmpeg يدوي | WebRTC gateway مخصص |
|---|---|---|---|
| Security | مصان، auth hooks، لا credentials للمتصفح | كل شيء علينا | سطح كبير نكتبه |
| Latency | WebRTC/WHEP < 500ms | حسب التنفيذ | ممتاز |
| Resources | remux بلا تحويل ⇒ CPU ~صفر | نفسه إن أُحسن | نفسه |
| On-demand | **`runOnDemandCloseAfter` مدمج** | نكتب دورة الحياة كاملة | نكتبها |
| Multi-tenant | مسارات معتمة + auth hook | علينا | علينا |
| Ops | binary/حاوية واحدة | إدارة عمليات | الأعلى تعقيدًا |

### **القرار: MediaMTX يبقى — مؤكَّد ومعزَّز.**

اكتشافات 2A تقوّيه ولا تضعفه:
- **الـfan-out هو المكسب الأكبر**: الـgateway يسحب جلسة RTSP **واحدة** لكل قناة ويوزّعها على N مشاهدين. رفع المحل يصبح **مستقلًا عن عدد المشاهدين** — وهذا حاسم لأن الرفع هو القيد (§9). الاتصال المباشر يضاعف الحمل مع كل مشاهد.
- `runOnDemandCloseAfter` يلغي حاجتنا لكتابة إدارة عمليات — أخطر جزء في أي بوابة وسائط.
- يعمل عند الحافة أو على الـVPS بنفس الإعداد ⇒ لا يتغير مع الانتقال للـAgent.

### الاستراتيجية النهائية

```
Grid 4/8/9/16 → Sub stream (CIF)  — إجباري
Grid 1        → Main
Fullscreen    → Main
تبويب مخفي   → إيقاف كل التدفقات (Page Visibility API)
```

**Playback**: بحث عبر `mediaFileFind.cgi`، تشغيل بـstreaming/range عبر البوابة. **لا تحميل يوم كامل** — أبدًا.

---

## 9. G · Bandwidth — بافتراضات صريحة

### الافتراضات (متحفظة عمدًا)

| البند | القيمة | لماذا |
|---|---|---|
| Main 1080N H.264 @15fps | **1,536 kbps** | وسط نطاق 32–4096 لجهاز اقتصادي؛ H.265 يقارب النصف لكننا نفترض H.264 لتوافق المتصفح (§8) |
| Sub CIF H.264 @7fps | **192 kbps** | CIF عند 7fps يقع 128–256 |
| Overhead (RTP/RTSP/IP) | **+10%** | |
| WebRTC للمشاهد | **+10%** فوق المصدر | |

### النتائج

| السيناريو | لكل تدفق | المجموع | + overhead |
|---|---|---|---|
| Grid 4 (sub) | 192 kbps | 0.77 Mbps | **0.85 Mbps** |
| Grid 9 (sub) | 192 kbps | 1.73 Mbps | **1.90 Mbps** |
| Grid 16 (sub) | 192 kbps | 3.07 Mbps | **3.38 Mbps** |
| Fullscreen main واحد | 1,536 kbps | 1.54 Mbps | **1.69 Mbps** |
| Grid 4 على **main** | 1,536 kbps | 6.14 Mbps | **6.76 Mbps** |

### التفسير

**رفع المحل (الأهم):** شبكة 16 تحتاج **~3.4 Mbps رفعًا مستمرًا**. شبكة 4 على main تحتاج **~6.8 Mbps** — غالبًا خارج قدرة اتصال منزلي/تجاري نمطي في مصر. ولهذا الـsub إجباري في الشبكات.

**بفضل الـfan-out**: هذه الأرقام ثابتة مهما بلغ عدد المشاهدين. ثلاثة موظفين يشاهدون 16 كاميرا = نفس الـ3.4 Mbps من المحل.

**VPS ingress:** = رفع المحل، ~3.4 Mbps. لا شيء يُذكر.
**VPS egress:** 3.4 × عدد المشاهدين + 10%. ثلاثة مشاهدين ≈ **11 Mbps**. مريح.
**تنزيل المستخدم:** = عمود «+ overhead». شبكة 16 ≈ 3.4 Mbps — يعمل على 4G.

### هل الـNIC 100 Mbps مشكلة؟

**لا.** أقصى سحب واقعي = 16 main × 1.5 Mbps ≈ **25 Mbps**، وهو ثلث سعة NIC وتحت سقف 64 Mbps المُعلن.

> **القيد الحقيقي هو رفع إنترنت المحل، وليس الـNIC ولا الـVPS ولا الـXVR.** أحتاج قياس الرفع الفعلي (§7 بند 2) قبل تثبيت أي وعد بالجودة.

---

## 10. H · Security Risks & Mitigations

| # | الخطر | الشدة | المعالجة |
|---|---|---|---|
| 1 | **Docker bridges 172.21–172.24 غير مغطاة** | 🔴 | توسيع الافتراضي إلى `172.16.0.0/12` + `SURVEILLANCE_BLOCKED_CIDRS` — **أول مهمة في 2B** |
| 2 | النفق الموجَّه يعطي الـVPS كامل شبكة المحل | 🟠 | تقييد AllowedIPs بعنوان الـXVR وحده لا `/24`؛ الوكيل يلغيها مستقبلًا |
| 3 | مفتاح WireGuard خاص يعيش على جهاز في المحل | 🟠 | مفتاح مخصّص لكل موقع، إبطال من الـVPS، لا مشاركة |
| 4 | UDP 51820 يصبح مكشوفًا | 🟡 | WireGuard لا يردّ على حزمة غير موقّعة — غير مرئي للمسح |
| 5 | credentials الجهاز مع طرف نقل | 🟠 | لا تغادر الخادم؛ الـagent مستقبلًا يستلمها مشتقة من شهادته |
| 6 | `proxyDahuaRequest` يتسلل يومًا | 🔴 | أوامر typed حصرًا (§11) + اختبار يمنع أي مسار عام |
| 7 | تغيير IP يقطع الجهاز | 🟠 | مسار §12 |
| 8 | حساب DVR بصلاحيات زائدة | 🟠 | §13 — والصراحة أن Dahua لا يعطي دقة كافية |
| 9 | تدفقات تتراكم فتستنزف الرفع | 🟠 | سقف لكل tenant/مستخدم + `runOnDemandCloseAfter` + Page Visibility |
| 10 | مقاطع مؤقتة تملأ قرصًا على 74% | 🟡 | البوابة streaming فقط، لا تسجيل؛ cache محدود ومراقَب (§15) |
| 11 | rate limit in-memory مع أكثر من replica | 🟡 | نقله إلى Redis (§14) |

---

## 11. Remote DVR Management — المسار الملزم

```
Browser ──> ERP API ──> requireSurveillanceOwner / permit()
                    ──> requireCapability(cap)          ← نموذج الـcapability
                    ──> surveillanceRateLimit(action)
                    ──> recordCriticalSurveillanceAudit ← قبل التنفيذ
                    ──> Provider (DahuaAdapter)
                    ──> Transport (SSRF guard + pinned IP)
                    ──> Dahua XVR
                    ──> settleSurveillanceAudit
```

### القاعدة غير القابلة للتفاوض

```js
// مسموح — فعل مُعرَّف بالأنواع، مُدقَّق، مُسجَّل
updateEncoderSettings(deviceId, channelIndex, { bitrate, fps, resolution })

// ممنوع — أي شكل من هذا
proxyDahuaRequest(url, body)
```

المتصفح لا يرى: كلمة مرور الجهاز · RTSP URL · العنوان أو المنفذ · Digest header · أي رد خام. يرى: أفعالًا مُسمّاة، حقولًا مُدقَّقة، وأكواد أخطاء.

**سيُضاف اختبار** يفشل إن ظهر مسار يقبل URL أو body عشوائيًا موجّهًا للجهاز — الحارس الوحيد الذي يصمد أمام «مؤقتًا للتشخيص».

---

## 12. Network Settings — مسار آمن (تصميم فقط)

تغيير IP يقطع الاتصال بالجهاز فورًا. المسار:

```
1. اقرأ الإعداد الحالي واحفظه كـ rollback
2. تحقق: IP في نطاق ممنوح · gateway في نفس الشبكة · لا تصادم · يمر حارس SSRF
3. اكتب النية في السجل (write-ahead) — قبل أي إرسال
4. تأكيد قوي: كتابة IP الجديد نصًّا + إعادة إدخال كلمة مرور الـERP (step-up)
5. طبّق — وتوقّع فشل الاتصال. الانقطاع نجاح متوقَّع لا خطأ
6. أعد المحاولة على العنوان الجديد: 5s ثم 10 ثم 20 ثم 40 (~2.5 دقيقة)
7. تحقق: نفس serial_hash ⇒ نفس الجهاز فعلًا
8. حدّث العنوان المخزَّن **فقط بعد النجاح**
9. أغلق السجل بالنتيجة
```

### إذا فشل reconnect

| | |
|---|---|
| العنوان المخزَّن | **لا يُغيَّر** — يبقى القديم |
| حالة الجهاز | `unreachable_after_network_change` + الإعداد المقترح والقديم |
| الواجهة | لافتة حمراء دائمة بالعنوانين وخطوات الاسترجاع |
| rollback تلقائي | **لا** — لا يمكن مخاطبة جهاز غير قابل للوصول. ادّعاء غير ذلك كذب |
| الحل | زيارة ميدانية أو DHCP reservation |

**لهذا `networkSettings` يبقى `read-only` في المنتج الأول.** يُفتح فقط بعد إثبات المسار على جهاز اختبار — لا على جهاز المحل العامل.

---

## 13. حساب `erp_surveillance` — الصلاحيات (بلا إنشاء)

### الدقة المتاحة في Dahua — والحقيقة غير المريحة

نموذج صلاحيات Dahua = ثلاثة تبويبات (**System · Playback · Monitor**) + تحديد القنوات المسموحة.

**التوثيق الصريح**: Dahua **لا يوفّر** الدقة المطلوبة. لا يمكن فصل:
- PTZ عن باقي التحكم
- إعدادات التسجيل عن إعدادات الشبكة
- Restart عن باقي System
- قراءة التخزين عن إدارته

كل ذلك يقع تحت **System** — وهو تبويب واحد شامل.

### النتيجة العملية — حسابان لا حساب واحد

| الحساب | صلاحيات Dahua | يستخدمه |
|---|---|---|
| `erp_surveillance` | **Monitor + Playback فقط**، بلا System | الافتراضي — Live، Playback، Snapshot، Health |
| `erp_surveillance_cfg` | Monitor + Playback + System | **اختياري**، لا يُخزَّن إلا إن فعّل المالك إعدادات الجهاز |

بلا الحساب الثاني: كل capabilities الكتابة تُعرَض `read-only` مع تفسير واضح، والنظام يعمل بالكامل للمشاهدة. هذا هو Principle of Least Privilege ضمن ما يسمح به العتاد فعلًا — بدل ادّعاء دقة غير موجودة.

**+ ملاحظة**: ONVIF يحتاج **حسابًا ثالثًا منفصلًا** (System > Account > ONVIF User) إن استُخدم كاحتياطي.

---

## 14. Redis للـRate Limiting — أوافقك

**التوصية: نعم، ينتقل في 2B.**

Phase 1 أثبت `erp-redis` (redis:7) يعمل في الإنتاج، و`cacheService.js` جاهز بـfallback تلقائي للذاكرة.

السبب ليس المستقبل فقط: حد `restart: 1/10 دقائق` **يفشل صامتًا** مع أكثر من عملية backend — كل عملية لها دلوها، فمرتان تعنيان مرتين. وحد إعادة تشغيل لا يحد إعادة التشغيل أسوأ من عدمه لأنه يوهم بالحماية.

**التصميم**: `INCR` + `EXPIRE` ذرّيًا، والسقوط للذاكرة عند غياب Redis يبقى (مع تسجيل تنبيه لأن السلوك يضعف). **لم أغيّر شيئًا** — بانتظار موافقتك كما طلبت.

---

## 15. القرص

`/dev/sda1` — 193G، 51G حرّة، **74%**.

**قاعدة**: لا تسجيلات DVR على الـVPS إطلاقًا. التسجيل مسؤولية الـXVR وقرصه. البوابة streaming بحت.

الـcache الوحيد المسموح: مقاطع HLS مؤقتة (بديل WebRTC) — **في tmpfs بذاكرة محدودة لا على القرص**، بسقف صريح، ومقياس يُرصد. لا يلمس القرص أصلًا فلا ينمو أبدًا.

**لم أنظّف أي ملف على الـVPS** كما طلبت. (`.codex-deploy*` القديمة تستحق تنظيفًا في نافذة منفصلة.)

---

## 16. I · خطة تنفيذ Phase 2B

> تبدأ فقط بعد §17 وبعد إتاحة مسار الشبكة.

### 2B-0 · إصلاح أمني (بلا اعتماد على الشبكة — يمكن أن يبدأ فورًا)
`surveillanceNetworkGuard.js` → توسيع deny الافتراضي إلى `172.16.0.0/12` + اختبار على العناوين الثمانية المرصودة.
`surveillanceGuards.js` → rate limits على Redis عبر `cacheService`.

### 2B-1 · Transport
`transports/DirectTransport.js` — Digest عبر undici، `maxRedirects: 0`، اتصال بالـIP المثبَّت والاسم في Host فقط، مهلات.
`transports/TunnelTransport.js` — يرث Direct، يضيف نطاق النفق.
تسجيلهما. **اختبارات ضد خادم HTTP وهمي محلي — لا جهاز.**

### 2B-2 · Dahua Adapter (تدريجي، قراءة أولًا)
`providers/dahua/dahuaCgi.js` (Digest + تحليل الردود) → `DahuaAdapter` بـ`testConnection` + `getDeviceInfo` **فقط**.
ثم `dahuaCapabilities.js` — probe يجرّب كل endpoint ويصنّف `supported`/`unsupported`/`unknown`. لا يفترض شيئًا.
ثم `getChannels` + الاستيراد.
**الكتابة (`update*`) لا تُنفَّذ في 2B إطلاقًا.**

### 2B-3 · API + شاشة الأجهزة
`routes/surveillance.js` — أفعال typed فقط، خلف `requireSurveillanceOwner`.
شاشة الأجهزة + Add Device Wizard + شاشة الـcapabilities.
`surveillance.json` (en/ar) — **اسم فريد**، مُسجَّل في `localeManifest.js` **و** `i18n.js`.
`rbacStore.js` — قسم sidebar.

### 2B-4 · إثبات على الجهاز
اتصال حقيقي واحد، مصرَّح به، على هدف محدد. تسجيل الموديل والـfirmware والقنوات والـcapabilities الفعلية. **مقارنة النتيجة بمصفوفة §6 وتصحيحها.**

### 2B-5 · اختبارات
اختبار يمنع أي مسار proxy عام · تذاكر · عزل الـtenant ضد Postgres بـtenantين (إغلاق الـKNOWN GAP من Phase 1) · حارس الشبكة الموسَّع.

**المؤجَّل صراحةً لـ2C**: Media gateway، Live view، Playback، كتابة الإعدادات، الـEdge Agent.

---

## 17. J · قرارات تحتاج موافقتك

| # | القرار | التكلفة | البديل |
|---|---|---|---|
| **1** | **شراء MikroTik (~40–60 دولارًا) للمحل** | مالية صغيرة، مرة واحدة | Raspberry Pi (أقل موثوقية)، أو Tailscale (تبعية طرف ثالث)، أو بناء الـAgent الآن (شهور) |
| **2** | **تثبيت `wireguard` على الـVPS + فتح UDP 51820 في UFW** | تغيير على إنتاج | لا بديل لأي حل نفق |
| **3** | **إنشاء `erp_surveillance` على الـXVR** (Monitor+Playback) | دقائق على الجهاز | استخدام حساب موجود — أرفضه |
| **4** | **هل ننشئ `erp_surveillance_cfg` أيضًا؟** | صلاحية System كاملة | الاكتفاء بالقراءة — أوصي بالتأجيل حتى نحتاجه |
| **5** | **قبول أن الشبكات ستستخدم CIF** | جودة أقل مما تتوقع | main في شبكة 4 فقط، ومشروط برفع ≥7 Mbps |
| **6** | **فرض H.264 على الـsub stream في إعداد الجهاز** | تعديل إعداد DVR | تحويل على الـVPS — أرفضه للشبكات |
| **7** | **نقل rate limits إلى Redis** | تعديل كود Phase 1 | إبقاؤها بالذاكرة مع القيد المعروف |
| **8** | **توسيع deny إلى `172.16.0.0/12`** | تعديل كود Phase 1 | تركها — لا أنصح، ثغرة مرصودة |
| **9** | MediaMTX على الـVPS | تثبيت — **2C لا 2B** | — |

**الأصغر والأكثر إلحاحًا: القرارات 1 و2.** بدونهما لا يوجد مسار شبكي و2B يتوقف عند 2B-0.

---

## المصادر

- [XVR1B16-I(1T) — الصفحة الرسمية](https://www.dahuasecurity.com/products/All-Products/HDCVI-Recorders/S-XVR-Series/XVR1B16-I(1T)=V2.0-SSD1T)
- [DH-XVR1B16-I datasheet (Dahua، 2022)](https://material.dahuasecurity.com/uploads/cpq/prm-os-srv-res/smart/datasheetzipfiles/XVR1B16-I_datasheet_20220530.pdf)
- [XVR1B16-I — مواصفات الموزّع](https://www.polvision.eu/en_US/p/XVR1B16-I/5587)
- [Dahua Technology XVR1B16-I — SourceSecurity](https://www.sourcesecurity.com/dahua-technology-xvr1b16-i-digital-video-recorder-dvr-technical-details.html)
- [صيغة RTSP لأجهزة Dahua](https://securitycamcenter.com/rtsp-url-address-format-dahua/)
- [Dahua Tech — إضافة كاميرا عبر ONVIF](https://dahuatech.zendesk.com/hc/en-gb/articles/19547918082706-How-to-add-IP-Camera-via-Onvif-protocol)
- [DahuaWiki — إضافة كاميرا طرف ثالث](https://dahuawiki.com/NVR/Basic_Setup/Add_3rd_Party_IP_Camera)
- [rroller/dahua — عميل HTTP API إنتاجي](https://github.com/rroller/dahua/blob/main/custom_components/dahua/client.py)
- [Amcrest HTTP API (نفس API الخاص بـDahua)](https://s3.amazonaws.com/amcrest-files/Amcrest+HTTP+API+3.2017.pdf)
- [DahuaWiki — New GUI / إضافة مستخدم](https://dahuawiki.com/New_GUI/Instructions/Add_User)
- [دليل مستخدم مسجّلات Dahua HDCVI](https://www.dahuasecurity.com/asset/upload/product/20180705/Dahua-HDCVI-DVR-Users-Manual-V4_0_0-20180605_pdf.pdf)
