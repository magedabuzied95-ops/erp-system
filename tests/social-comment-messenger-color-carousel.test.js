import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPolishedSocialCommentProductReply,
  buildSocialCommentColorCards,
  normalizeSocialCommentColorDisplay,
  socialCommentCarouselEligible,
  swapSizeButtonsCtaForPlainAsk,
} from "../server/services/socialCommentPrivateReplyService.js";
import {
  buildSocialCommentMessengerCarouselPayload,
  buildSocialCommentMessengerProductCardPayload,
} from "../server/services/marketingCommentAutomationService.js";

const colorRow = (overrides = {}) => ({
  color_key: "black",
  color_label: "Black",
  color_sort_order: 0,
  gallery_image_url: "",
  variant_image_url: "https://cdn.example.com/black.jpg",
  ...overrides,
});

const variantRow = (color, size) => ({ color, size, stock: 3 });

test("each colour becomes its own card carrying only that colour's sizes and a link that opens it", () => {
  const cards = buildSocialCommentColorCards({
    variantRows: [
      variantRow("Black", "41"),
      variantRow("Black", "40"),
      variantRow("White", "43"),
    ],
    colorRows: [
      colorRow(),
      colorRow({ color_key: "white", color_label: "White", variant_image_url: "https://cdn.example.com/white.jpg" }),
    ],
    productName: "شبشب كروكس",
    productLink: "https://tigerstore.shop/shop/product/512",
  });

  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].sizes, ["40", "41"]);
  assert.deepEqual(cards[1].sizes, ["43"]);
  assert.equal(cards[0].colorLabel, "أسود");
  assert.equal(cards[1].colorLabel, "أبيض");
  assert.equal(cards[0].productLink, "https://tigerstore.shop/shop/product/512?color=Black");
  assert.equal(cards[1].productLink, "https://tigerstore.shop/shop/product/512?color=White");
});

test("a colour name is never torn apart by the letters inside it", () => {
  // Every one of these is a real catalogue value the old separator mangled: it matched "and"
  // and "و" anywhere, not only as standalone words.
  assert.equal(normalizeSocialCommentColorDisplay("Burgandy"), "Burgandy");
  assert.equal(normalizeSocialCommentColorDisplay("Sandy"), "Sandy");
  assert.equal(normalizeSocialCommentColorDisplay("White & Burgandy"), "أبيض / Burgandy");
  assert.equal(normalizeSocialCommentColorDisplay("أسود وأبيض"), "أسود وأبيض");
  assert.equal(normalizeSocialCommentColorDisplay("وردي"), "وردي");
});

test("colours genuinely joined by a separator still split", () => {
  assert.equal(normalizeSocialCommentColorDisplay("Black & Gray"), "أسود / رمادي");
  assert.equal(normalizeSocialCommentColorDisplay("Black and White"), "أسود / أبيض");
  assert.equal(normalizeSocialCommentColorDisplay("أسود و أبيض"), "أسود / أبيض");
  assert.equal(normalizeSocialCommentColorDisplay("Black/White"), "أسود / أبيض");
  assert.equal(normalizeSocialCommentColorDisplay("Red + Blue"), "أحمر / أزرق");
});

test("a gallery photo for the colour outranks the colour's variant photo", () => {
  const [card] = buildSocialCommentColorCards({
    variantRows: [variantRow("Black", "41")],
    colorRows: [colorRow({
      gallery_image_url: "https://cdn.example.com/gallery-black.jpg",
      variant_image_url: "https://cdn.example.com/variant-black.jpg",
    })],
    productName: "شبشب كروكس",
    productLink: "https://tigerstore.shop/shop/product/512",
  });
  assert.equal(card.imageUrl, "https://cdn.example.com/gallery-black.jpg");
});

test("a colour with no photo of its own is not a card", () => {
  const cards = buildSocialCommentColorCards({
    variantRows: [variantRow("Black", "41"), variantRow("White", "42")],
    colorRows: [
      colorRow(),
      colorRow({ color_key: "white", color_label: "White", variant_image_url: "", gallery_image_url: "" }),
    ],
    productName: "شبشب كروكس",
    productLink: "https://tigerstore.shop/shop/product/512",
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].colorKey, "black");
});

test("one colour, or two colours sharing one photo, is not a carousel", () => {
  const oneColor = [{ colorKey: "black", imageUrl: "https://cdn.example.com/black.jpg" }];
  assert.equal(socialCommentCarouselEligible(oneColor), false);

  const sharedPhoto = [
    { colorKey: "black", imageUrl: "https://cdn.example.com/main.jpg" },
    { colorKey: "white", imageUrl: "https://cdn.example.com/main.jpg" },
  ];
  assert.equal(socialCommentCarouselEligible(sharedPhoto), false);

  const distinct = [
    { colorKey: "black", imageUrl: "https://cdn.example.com/black.jpg" },
    { colorKey: "white", imageUrl: "https://cdn.example.com/white.jpg" },
  ];
  assert.equal(socialCommentCarouselEligible(distinct), true);
});

test("the carousel payload is a Messenger generic template addressed to the comment", () => {
  const payload = buildSocialCommentMessengerCarouselPayload({
    commentId: "comment_1",
    productName: "شبشب كروكس",
    productPrice: "1250",
    colorCards: [
      { colorLabel: "أسود", imageUrl: "https://cdn.example.com/black.jpg", productLink: "https://shop/512?color=Black", sizes: ["40", "41"] },
      { colorLabel: "أبيض", imageUrl: "https://cdn.example.com/white.jpg", productLink: "https://shop/512?color=White", sizes: ["43"] },
    ],
  });

  assert.deepEqual(payload.recipient, { comment_id: "comment_1" });
  assert.equal(payload.message.attachment.type, "template");
  assert.equal(payload.message.attachment.payload.template_type, "generic");

  const [first, second] = payload.message.attachment.payload.elements;
  assert.equal(first.title, "شبشب كروكس — أسود — 1250 جنيه");
  assert.equal(first.subtitle, "المقاسات: 40 | 41");
  assert.equal(first.image_url, "https://cdn.example.com/black.jpg");
  assert.deepEqual(first.buttons, [{ type: "web_url", url: "https://shop/512?color=Black", title: "عرض المنتج" }]);
  assert.equal(second.title, "شبشب كروكس — أبيض — 1250 جنيه");
});

test("a single usable colour never ships as a one-card carousel", () => {
  const payload = buildSocialCommentMessengerCarouselPayload({
    commentId: "comment_1",
    colorCards: [
      { colorLabel: "أسود", imageUrl: "https://cdn.example.com/black.jpg", sizes: ["40"] },
      { colorLabel: "أبيض", imageUrl: "", sizes: ["43"] },
    ],
  });
  assert.equal(payload, null);
});

test("more colours than Messenger accepts are capped at ten", () => {
  const colorCards = Array.from({ length: 14 }, (_unused, index) => ({
    colorLabel: `لون ${index}`,
    imageUrl: `https://cdn.example.com/${index}.jpg`,
    sizes: ["41"],
  }));
  const payload = buildSocialCommentMessengerCarouselPayload({ commentId: "c", colorCards });
  assert.equal(payload.message.attachment.payload.elements.length, 10);
});

test("a long size list drops whole sizes instead of cutting one in half", () => {
  // 20 sizes overflow Messenger's 80-character subtitle, so this case must really truncate —
  // a list that happens to fit would prove nothing.
  const sizes = Array.from({ length: 20 }, (_unused, index) => String(30 + index));
  const payload = buildSocialCommentMessengerCarouselPayload({
    commentId: "c",
    colorCards: [
      { colorLabel: "أسود", imageUrl: "https://cdn.example.com/a.jpg", sizes },
      { colorLabel: "أبيض", imageUrl: "https://cdn.example.com/b.jpg", sizes: ["41"] },
    ],
  });
  const [first] = payload.message.attachment.payload.elements;
  assert.ok(first.subtitle.length <= 80, `subtitle was ${first.subtitle.length} chars`);
  assert.match(first.subtitle, /^المقاسات: 30 \| 31/);
  assert.doesNotMatch(first.subtitle, /\|\s*…?$/, "a trailing separator means a size was cut off mid-list");

  const shown = first.subtitle
    .replace(/^المقاسات: /, "")
    .replace(/\s*…$/, "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  assert.ok(shown.length < sizes.length, "this case is only meaningful if some sizes were dropped");
  for (const size of shown) {
    assert.ok(sizes.includes(size), `"${size}" is not one of the real sizes — it is the leftover half of one`);
  }
});

test("the single-card path still fits inside Messenger's field limits", () => {
  const payload = buildSocialCommentMessengerProductCardPayload({
    commentId: "c",
    productName: "شبشب كروكس رجالي",
    productImageUrl: "https://cdn.example.com/main.jpg",
    productUrl: "https://shop/512",
    productPrice: "1250",
    availableSizes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47"],
  });
  const [element] = payload.message.attachment.payload.elements;
  assert.ok(element.title.length <= 80);
  assert.ok(element.subtitle.length <= 80, `subtitle was ${element.subtitle.length} chars`);
  assert.match(element.subtitle, /السعر: 1250 جنيه/);
});

test("the carousel DM tells the customer to swipe, and never repeats what the cards already say", () => {
  const message = buildPolishedSocialCommentProductReply({
    customerName: "أحمد",
    productContext: {
      __normalized_private_reply_context: true,
      productName: "شبشب كروكس",
      priceUsed: "1250",
      availableSizes: ["40", "41"],
      availableSizesLabel: "40 | 41",
      productLink: "https://tigerstore.shop/shop/product/512",
      carouselEligible: true,
    },
  });

  assert.match(message, /^أهلاً بحضرتك يا أحمد ✨/);
  assert.match(message, /دوس يمين وشمال على الكروت/);
  assert.match(message, /واختار مقاسك من الأزرار تحت/);
  assert.match(message, /متاح شحن لجميع المحافظات/);
  assert.match(message, /متاح الدفع عند الاستلام ❤️/);
  assert.doesNotMatch(message, /1250/, "the cards carry the price; the text must not repeat it");
  assert.doesNotMatch(message, /shop\/product/, "the cards carry the link; the text must not repeat it");
  assert.doesNotMatch(message, /المقاسات المتاحة:/, "the cards carry the sizes; the text must not repeat it");
  // The retired copy opened a line with a lone U+FE0F left behind by a deleted emoji, which
  // renders as a stray gap. A real emoji carries its selector after a base character, never first.
  const orphanedSelector = message.split("\n").find((line) => line.startsWith("️"));
  assert.equal(orphanedSelector, undefined, "no line may open with an orphaned variation selector");
});

test("a single-colour product is never told to swipe through cards", () => {
  const message = buildPolishedSocialCommentProductReply({
    customerName: "أحمد",
    productContext: {
      __normalized_private_reply_context: true,
      productName: "شبشب كروكس",
      priceUsed: "1250",
      availableSizes: ["40"],
      availableSizesLabel: "40",
      productLink: "https://tigerstore.shop/shop/product/512",
      carouselEligible: false,
    },
  });
  assert.doesNotMatch(message, /دوس يمين وشمال/);
  assert.match(message, /على الكارت فوق/);
  assert.match(message, /واختار مقاسك من الأزرار تحت/);
});

test("with no sizes there are no size buttons, so the text asks for the size instead", () => {
  const message = buildPolishedSocialCommentProductReply({
    customerName: "",
    productContext: {
      __normalized_private_reply_context: true,
      productName: "شبشب كروكس",
      priceUsed: "",
      availableSizes: [],
      availableSizesLabel: "",
      productLink: "https://tigerstore.shop/shop/product/512",
      carouselEligible: false,
    },
  });
  assert.match(message, /^أهلاً بحضرتك ✨/);
  assert.doesNotMatch(message, /من الأزرار تحت/);
  assert.match(message, /ابعتلنا المقاس المطلوب/);
});

test("a retry that had to drop the quick replies stops pointing at buttons", () => {
  const withButtons = buildPolishedSocialCommentProductReply({
    customerName: "أحمد",
    productContext: {
      __normalized_private_reply_context: true,
      productName: "شبشب كروكس",
      availableSizes: ["40", "41"],
      availableSizesLabel: "40 | 41",
      carouselEligible: true,
    },
  });
  const plain = swapSizeButtonsCtaForPlainAsk(withButtons);
  assert.match(withButtons, /من الأزرار تحت/);
  assert.doesNotMatch(plain, /من الأزرار تحت/);
  assert.match(plain, /ابعتلنا المقاس المطلوب/);
});
