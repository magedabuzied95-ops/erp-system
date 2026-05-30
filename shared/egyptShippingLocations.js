const provider = "manual";

const g = (id, en, ar, cities) => ({ id, name_en: en, name_ar: ar, cities });
const emptyProviderMapping = () => ({
  provider_city_id: "",
  provider_district_id: "",
  provider_zone_id: "",
});
const normalizeNameTuple = (value) => (Array.isArray(value) ? { id: value[0], name_en: value[1], name_ar: value[2] } : { id: value, name_en: value, name_ar: value });
const zoneForDistrict = (district) => ({
  id: `${district.id}-zone`,
  name_en: district.name_en,
  name_ar: district.name_ar,
  ...emptyProviderMapping(),
});
const districtFromArea = (area) => {
  const district = normalizeNameTuple(area);
  return {
    ...district,
    ...emptyProviderMapping(),
    zones: [zoneForDistrict(district)],
  };
};
const c = (id, en, ar, districts = []) => {
  const normalizedDistricts = districts.length
    ? districts.map(districtFromArea)
    : [districtFromArea([`${id}-center`, en, ar])];
  return {
    id,
    name_en: en,
    name_ar: ar,
    ...emptyProviderMapping(),
    districts: normalizedDistricts,
    areas: normalizedDistricts,
  };
};

export const egyptShippingLocationTree = [
  g("cairo", "Cairo", "القاهرة", [
    c("cairo-nasr-city", "Nasr City", "مدينة نصر", [["cairo-nasr-city-1", "Nasr City 1", "مدينة نصر أول"], ["cairo-nasr-city-2", "Nasr City 2", "مدينة نصر ثان"], ["cairo-abbas-akkad", "Abbas El Akkad", "عباس العقاد"], ["cairo-makram", "Makram Ebeid", "مكرم عبيد"]]),
    c("cairo-heliopolis", "Heliopolis", "مصر الجديدة", [["cairo-roxy", "Roxy", "روكسي"], ["cairo-korba", "Korba", "الكوربة"], ["cairo-merryland", "Merryland", "الميريلاند"], ["cairo-almaza", "Almaza", "ألماظة"]]),
    c("cairo-new-cairo", "New Cairo", "القاهرة الجديدة", [["cairo-fifth-settlement", "Fifth Settlement", "التجمع الخامس"], ["cairo-first-settlement", "First Settlement", "التجمع الأول"], ["cairo-rehab", "Rehab", "الرحاب"], ["cairo-madinaty", "Madinaty", "مدينتي"]]),
    c("cairo-maadi", "Maadi", "المعادي", [["cairo-zahraa-maadi", "Zahraa Maadi", "زهراء المعادي"], ["cairo-new-maadi", "New Maadi", "المعادي الجديدة"], ["cairo-degla", "Degla", "دجلة"], ["cairo-corniche-maadi", "Maadi Corniche", "كورنيش المعادي"]]),
    c("cairo-shorouk", "Shorouk", "الشروق"), c("cairo-obour", "Obour", "العبور"), c("cairo-shubra", "Shubra", "شبرا"), c("cairo-helwan", "Helwan", "حلوان"), c("cairo-downtown", "Downtown", "وسط البلد"), c("cairo-zamalek", "Zamalek", "الزمالك"), c("cairo-mokattam", "Mokattam", "المقطم"), c("cairo-ain-shams", "Ain Shams", "عين شمس"), c("cairo-salam", "El Salam", "السلام"),
  ]),
  g("giza", "Giza", "الجيزة", [
    c("giza-dokki", "Dokki", "الدقي"), c("giza-mohandessin", "Mohandessin", "المهندسين"), c("giza-agouza", "Agouza", "العجوزة"), c("giza-haram", "Haram", "الهرم", [["giza-mansoureya", "Mansoureya", "المنصورية"], ["giza-maryouteya", "Maryouteya", "المريوطية"], ["giza-hadayek-ahram", "Hadayek Al Ahram", "حدائق الأهرام"]]), c("giza-faisal", "Faisal", "فيصل"), c("giza-october", "6th of October", "6 أكتوبر", [["giza-october-1", "First District", "الحي الأول"], ["giza-october-7", "Seventh District", "الحي السابع"], ["giza-industrial-zone", "Industrial Zone", "المنطقة الصناعية"]]), c("giza-zayed", "Sheikh Zayed", "الشيخ زايد"), c("giza-imbaba", "Imbaba", "إمبابة"), c("giza-warraq", "Warraq", "الوراق"), c("giza-badrashein", "Badrashein", "البدرشين"), c("giza-awsim", "Awsim", "أوسيم"), c("giza-kerdasa", "Kerdasa", "كرداسة"),
  ]),
  g("alexandria", "Alexandria", "الإسكندرية", [
    c("alex-smouha", "Smouha", "سموحة"), c("alex-sidi-gaber", "Sidi Gaber", "سيدي جابر"), c("alex-moharam-bek", "Moharam Bek", "محرم بك"), c("alex-agami", "Agami", "العجمي"), c("alex-asafra", "Asafra", "العصافرة"), c("alex-miami", "Miami", "ميامي"), c("alex-stanley", "Stanley", "ستانلي"), c("alex-laurent", "Laurent", "لوران"), c("alex-gleem", "Gleem", "جليم"), c("alex-montaza", "Montaza", "المنتزه"), c("alex-borg-el-arab", "Borg El Arab", "برج العرب"), c("alex-amreya", "Amreya", "العامرية"),
  ]),
  g("dakahlia", "Dakahlia", "الدقهلية", [c("dak-mansoura", "Mansoura", "المنصورة", [["dak-toriel", "Toriel", "توريل"], ["dak-mashaya", "El Mashaya", "المشاية"], ["dak-gamaa", "University District", "حي الجامعة"]]), c("dak-talkha", "Talkha", "طلخا"), c("dak-mit-ghamr", "Mit Ghamr", "ميت غمر"), c("dak-dekernis", "Dekernis", "دكرنس"), c("dak-aga", "Aga", "أجا"), c("dak-sinbillawin", "Sinbillawin", "السنبلاوين"), c("dak-minyet-nasr", "Minyet El Nasr", "منية النصر"), c("dak-belqas", "Belqas", "بلقاس"), c("dak-sherbin", "Sherbin", "شربين"), c("dak-gamaliya", "Gamaliya", "الجمالية"), c("dak-matareya", "Matareya", "المطرية")]),
  g("sharqia", "Sharqia", "الشرقية", [c("shar-zagazig", "Zagazig", "الزقازيق"), c("shar-10th-ramadan", "10th of Ramadan", "العاشر من رمضان"), c("shar-belbeis", "Belbeis", "بلبيس"), c("shar-minya-el-qamh", "Minya El Qamh", "منيا القمح"), c("shar-abu-hammad", "Abu Hammad", "أبو حماد"), c("shar-faqous", "Faqous", "فاقوس"), c("shar-hehya", "Hehya", "ههيا"), c("shar-kafr-saqr", "Kafr Saqr", "كفر صقر"), c("shar-abu-kebir", "Abu Kebir", "أبو كبير"), c("shar-husseiniya", "Husseiniya", "الحسينية"), c("shar-deirb-negm", "Deirb Negm", "ديرب نجم")]),
  g("gharbia", "Gharbia", "الغربية", [c("ghar-tanta", "Tanta", "طنطا"), c("ghar-mahalla", "Mahalla El Kubra", "المحلة الكبرى"), c("ghar-kafr-el-zayat", "Kafr El Zayat", "كفر الزيات"), c("ghar-zifta", "Zifta", "زفتى"), c("ghar-santa", "El Santa", "السنطة"), c("ghar-basyoun", "Basyoun", "بسيون"), c("ghar-qotour", "Qotour", "قطور"), c("ghar-samanoud", "Samanoud", "سمنود")]),
  g("monufia", "Monufia", "المنوفية", [c("mon-shebin", "Shebin El Kom", "شبين الكوم"), c("mon-sadat", "Sadat City", "مدينة السادات"), c("mon-menouf", "Menouf", "منوف"), c("mon-ashmoun", "Ashmoun", "أشمون"), c("mon-tala", "Tala", "تلا"), c("mon-quesna", "Quesna", "قويسنا"), c("mon-bagour", "Bagour", "الباجور"), c("mon-berket", "Berket El Saba", "بركة السبع"), c("mon-shohadaa", "Shohadaa", "الشهداء")]),
  g("qalyubia", "Qalyubia", "القليوبية", [c("qal-banha", "Banha", "بنها"), c("qal-shubra-kheima", "Shubra El Kheima", "شبرا الخيمة"), c("qal-qanater", "Qanater El Khayreya", "القناطر الخيرية"), c("qal-khanka", "Khanka", "الخانكة"), c("qal-khosous", "Khosous", "الخصوص"), c("qal-qalyub", "Qalyub", "قليوب"), c("qal-toukh", "Toukh", "طوخ"), c("qal-kafr-shokr", "Kafr Shokr", "كفر شكر"), c("qal-shebin-qanater", "Shebin El Qanater", "شبين القناطر"), c("qal-obour", "Obour", "العبور")]),
  g("beheira", "Beheira", "البحيرة", [c("beh-damanhour", "Damanhour", "دمنهور"), c("beh-kafr-dawar", "Kafr El Dawar", "كفر الدوار"), c("beh-rashid", "Rashid", "رشيد"), c("beh-edko", "Edko", "إدكو"), c("beh-abu-hummus", "Abu Hummus", "أبو حمص"), c("beh-mahmoudiya", "Mahmoudiya", "المحمودية"), c("beh-hosh-issa", "Hosh Essa", "حوش عيسى"), c("beh-delengat", "Delengat", "الدلنجات"), c("beh-etay", "Etay El Baroud", "إيتاي البارود"), c("beh-wadi-natrun", "Wadi El Natrun", "وادي النطرون")]),
  g("kafr-el-sheikh", "Kafr El Sheikh", "كفر الشيخ", [c("kes-kafr-el-sheikh", "Kafr El Sheikh", "كفر الشيخ"), c("kes-desouk", "Desouk", "دسوق"), c("kes-fouh", "Fouh", "فوه"), c("kes-motobas", "Motobas", "مطوبس"), c("kes-bella", "Bella", "بيلا"), c("kes-hamoul", "Hamoul", "الحامول"), c("kes-sidi-salem", "Sidi Salem", "سيدي سالم"), c("kes-qallin", "Qallin", "قلين"), c("kes-baltim", "Baltim", "بلطيم"), c("kes-riyadh", "Riyadh", "الرياض")]),
  g("damietta", "Damietta", "دمياط", [c("dam-damietta", "Damietta", "دمياط"), c("dam-new-damietta", "New Damietta", "دمياط الجديدة", [["dam-new-first", "First District", "الحي الأول"], ["dam-new-second", "Second District", "الحي الثاني"], ["dam-new-central", "Central District", "المنطقة المركزية"]]), c("dam-ras-elbar", "Ras El Bar", "رأس البر"), c("dam-faraskour", "Faraskour", "فارسكور"), c("dam-zarqa", "Zarqa", "الزرقا"), c("dam-kafr-saad", "Kafr Saad", "كفر سعد"), c("dam-kafr-batikh", "Kafr El Batikh", "كفر البطيخ"), c("dam-ezbet-borg", "Ezbet El Borg", "عزبة البرج")]),
  g("port-said", "Port Said", "بورسعيد", [c("ps-east", "El Sharq District", "حي الشرق"), c("ps-arab", "El Arab District", "حي العرب"), c("ps-manakh", "El Manakh District", "حي المناخ"), c("ps-dawahy", "El Dawahy District", "حي الضواحي"), c("ps-zohour", "El Zohour District", "حي الزهور"), c("ps-port-fouad", "Port Fouad", "بورفؤاد"), c("ps-south", "South District", "حي الجنوب"), c("ps-west", "West District", "حي غرب")]),
  g("ismailia", "Ismailia", "الإسماعيلية", [c("ism-ismailia", "Ismailia", "الإسماعيلية"), c("ism-fayed", "Fayed", "فايد"), c("ism-qantara-east", "Qantara East", "القنطرة شرق"), c("ism-qantara-west", "Qantara West", "القنطرة غرب"), c("ism-tal-kebir", "Tal El Kebir", "التل الكبير"), c("ism-abu-suweir", "Abu Suweir", "أبو صوير"), c("ism-qassasin", "Qassasin", "القصاصين")]),
  g("suez", "Suez", "السويس", [c("suez-suez", "Suez District", "حي السويس"), c("suez-arbaeen", "Arbaeen", "الأربعين"), c("suez-ataqa", "Ataqa", "عتاقة"), c("suez-faisal", "Faisal", "فيصل"), c("suez-ganayen", "Ganayen", "الجناين")]),
  g("north-sinai", "North Sinai", "شمال سيناء", [c("ns-arish", "Arish", "العريش"), c("ns-sheikh-zowaid", "Sheikh Zowaid", "الشيخ زويد"), c("ns-rafah", "Rafah", "رفح"), c("ns-bir-el-abd", "Bir El Abd", "بئر العبد"), c("ns-hasna", "Hasna", "الحسنة"), c("ns-nakhl", "Nakhl", "نخل")]),
  g("south-sinai", "South Sinai", "جنوب سيناء", [c("ss-tor", "El Tor", "طور سيناء"), c("ss-sharm", "Sharm El Sheikh", "شرم الشيخ"), c("ss-dahab", "Dahab", "دهب"), c("ss-nuweiba", "Nuweiba", "نويبع"), c("ss-taba", "Taba", "طابا"), c("ss-saint-catherine", "Saint Catherine", "سانت كاترين"), c("ss-ras-sedr", "Ras Sedr", "رأس سدر"), c("ss-abu-rudeis", "Abu Rudeis", "أبو رديس"), c("ss-abu-zenima", "Abu Zenima", "أبو زنيمة")]),
  g("fayoum", "Fayoum", "الفيوم", [c("fay-fayoum", "Fayoum", "الفيوم"), c("fay-senuris", "Senuris", "سنورس"), c("fay-tamiya", "Tamiya", "طامية"), c("fay-itsa", "Itsa", "إطسا"), c("fay-abshway", "Abshway", "أبشواي"), c("fay-youssef", "Youssef El Seddik", "يوسف الصديق")]),
  g("beni-suef", "Beni Suef", "بني سويف", [c("bs-beni-suef", "Beni Suef", "بني سويف"), c("bs-new-beni-suef", "New Beni Suef", "بني سويف الجديدة"), c("bs-wasta", "Wasta", "الواسطى"), c("bs-nasser", "Nasser", "ناصر"), c("bs-ehnasia", "Ehnasia", "إهناسيا"), c("bs-beba", "Beba", "ببا"), c("bs-somosta", "Somosta", "سمسطا"), c("bs-fashn", "Fashn", "الفشن")]),
  g("minya", "Minya", "المنيا", [c("min-minya", "Minya", "المنيا"), c("min-new-minya", "New Minya", "المنيا الجديدة"), c("min-mallawi", "Mallawi", "ملوي"), c("min-samalout", "Samalout", "سمالوط"), c("min-matai", "Matai", "مطاي"), c("min-beni-mazar", "Beni Mazar", "بني مزار"), c("min-maghagha", "Maghagha", "مغاغة"), c("min-deir-mawas", "Deir Mawas", "دير مواس"), c("min-abu-qurqas", "Abu Qurqas", "أبو قرقاص"), c("min-adwa", "Adwa", "العدوة")]),
  g("assiut", "Assiut", "أسيوط", [c("asy-assiut", "Assiut", "أسيوط"), c("asy-new-assiut", "New Assiut", "أسيوط الجديدة"), c("asy-dayrout", "Dayrout", "ديروط"), c("asy-qusiya", "Qusiya", "القوصية"), c("asy-manfalout", "Manfalout", "منفلوط"), c("asy-abnoub", "Abnoub", "أبنوب"), c("asy-abu-tig", "Abu Tig", "أبو تيج"), c("asy-ghanayem", "Ghanayem", "الغنايم"), c("asy-sahel-selim", "Sahel Selim", "ساحل سليم"), c("asy-badari", "Badari", "البداري"), c("asy-sedfa", "Sedfa", "صدفا")]),
  g("sohag", "Sohag", "سوهاج", [c("soh-sohag", "Sohag", "سوهاج"), c("soh-new-sohag", "New Sohag", "سوهاج الجديدة"), c("soh-akhmim", "Akhmim", "أخميم"), c("soh-girga", "Girga", "جرجا"), c("soh-tahta", "Tahta", "طهطا"), c("soh-tama", "Tama", "طما"), c("soh-maragha", "Maragha", "المراغة"), c("soh-baliana", "Baliana", "البلينا"), c("soh-mansha", "Mansha", "المنشاة"), c("soh-dar-salam", "Dar El Salam", "دار السلام"), c("soh-juhayna", "Juhayna", "جهينة")]),
  g("qena", "Qena", "قنا", [c("qen-qena", "Qena", "قنا"), c("qen-new-qena", "New Qena", "قنا الجديدة"), c("qen-nag-hammadi", "Nag Hammadi", "نجع حمادي"), c("qen-dishna", "Dishna", "دشنا"), c("qen-qift", "Qift", "قفط"), c("qen-qus", "Qus", "قوص"), c("qen-naqada", "Naqada", "نقادة"), c("qen-farshout", "Farshout", "فرشوط"), c("qen-abu-tesht", "Abu Tesht", "أبو تشت"), c("qen-waqf", "Waqf", "الوقف")]),
  g("luxor", "Luxor", "الأقصر", [c("lux-luxor", "Luxor", "بندر الأقصر"), c("lux-zainiya", "Zainiya", "الزينية"), c("lux-bayadiya", "Bayadiya", "البياضية"), c("lux-qurna", "Qurna", "القرنة"), c("lux-armant", "Armant", "أرمنت"), c("lux-esna", "Esna", "إسنا"), c("lux-tod", "Tod", "الطود")]),
  g("aswan", "Aswan", "أسوان", [c("asw-aswan", "Aswan", "أسوان"), c("asw-new-aswan", "New Aswan", "أسوان الجديدة"), c("asw-daraw", "Daraw", "دراو"), c("asw-kom-ombo", "Kom Ombo", "كوم أمبو"), c("asw-nasr-nuba", "Nasr El Nuba", "نصر النوبة"), c("asw-edfu", "Edfu", "إدفو"), c("asw-abu-simbel", "Abu Simbel", "أبو سمبل")]),
  g("red-sea", "Red Sea", "البحر الأحمر", [c("rs-hurghada", "Hurghada", "الغردقة"), c("rs-ras-gharib", "Ras Gharib", "رأس غارب"), c("rs-safaga", "Safaga", "سفاجا"), c("rs-quseir", "Quseir", "القصير"), c("rs-marsa-alam", "Marsa Alam", "مرسى علم"), c("rs-shalateen", "Shalateen", "الشلاتين"), c("rs-halayeb", "Halayeb", "حلايب")]),
  g("new-valley", "New Valley", "الوادي الجديد", [c("nv-kharga", "Kharga", "الخارجة"), c("nv-dakhla", "Dakhla", "الداخلة"), c("nv-farafra", "Farafra", "الفرافرة"), c("nv-paris", "Paris", "باريس"), c("nv-balat", "Balat", "بلاط")]),
  g("matrouh", "Matrouh", "مطروح", [c("mat-marsa-matrouh", "Marsa Matrouh", "مرسى مطروح"), c("mat-hamam", "Hamam", "الحمام"), c("mat-alamein", "Alamein", "العلمين"), c("mat-dabaa", "Dabaa", "الضبعة"), c("mat-negila", "Negila", "النجيلة"), c("mat-sidi-barrani", "Sidi Barrani", "سيدي براني"), c("mat-salloum", "Salloum", "السلوم"), c("mat-siwa", "Siwa", "سيوة")]),
];

export const flattenEgyptShippingLocations = (tree = egyptShippingLocationTree) =>
  tree.flatMap((governorate) =>
    governorate.cities.flatMap((city) =>
      (city.districts?.length ? city.districts : [districtFromArea([`${city.id}-center`, city.name_en, city.name_ar])]).flatMap((district) =>
        (district.zones?.length ? district.zones : [zoneForDistrict(district)]).map((zone) => ({
        id: zone.id,
        governorate_id: governorate.id,
        governorate_name_en: governorate.name_en,
        governorate_name_ar: governorate.name_ar,
        city_id: city.id,
        city_name_en: city.name_en,
        city_name_ar: city.name_ar,
        district_id: district.id,
        district_name_en: district.name_en,
        district_name_ar: district.name_ar,
        zone_id: zone.id,
        zone_name_en: zone.name_en,
        zone_name_ar: zone.name_ar,
        area_id: district.id,
        area_name_en: district.name_en,
        area_name_ar: district.name_ar,
        provider_location_code: "",
        provider_city_id: city.provider_city_id || "",
        provider_district_id: district.provider_district_id || "",
        provider_zone_id: zone.provider_zone_id || "",
        provider,
        active: true,
      }))
      )
    )
  );

export const defaultEgyptShippingLocations = flattenEgyptShippingLocations();
