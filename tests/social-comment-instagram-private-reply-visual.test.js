import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSocialCommentInstagramPrivateReplyPayload,
  restoreProductFactsToText,
} from "../server/services/marketingCommentAutomationService.js";
import {
  buildPolishedSocialCommentProductReply,
  stripCardPointersFromText,
} from "../server/services/socialCommentPrivateReplyService.js";

// Meta allows exactly one private reply per Instagram comment. These tests pin what that one
// message is made of, and what the text becomes when the pictures cannot go out.

const colorCard = (color, image, sizes) => ({
  colorKey: color.toLowerCase(),
  color,
  colorLabel: color,
  productName: "New Balance 530",
  imageUrl: image,
  productLink: `https://m1store-egy.com/shop/product/530?color=${color}`,
  sizes,
});

const carouselContext = () => ({
  productName: "New Balance 530",
  productLink: "https://m1store-egy.com/shop/product/530",
  productImageUrl: "https://cdn.example.com/530-main.jpg",
  priceUsed: "850",
  availableSizes: ["40", "41", "42"],
  carouselEligible: true,
  colorCards: [
    colorCard("Black", "https://cdn.example.com/530-black.jpg", ["40", "41"]),
    colorCard("White", "https://cdn.example.com/530-white.jpg", ["42"]),
    colorCard("Navy", "https://cdn.example.com/530-navy.jpg", ["41", "42"]),
  ],
});

test("a multi-colour product spends Instagram's single private reply on the colour carousel", () => {
  const plan = buildSocialCommentInstagramPrivateReplyPayload({
    commentId: "17899999999999999",
    normalizedContext: carouselContext(),
  });

  assert.equal(plan.mode, "color_carousel");
  assert.equal(plan.elements, 3);
  assert.deepEqual(plan.payload.recipient, { comment_id: "17899999999999999" });
  const template = plan.payload.message.attachment.payload;
  assert.equal(template.template_type, "generic");
  // image_aspect_ratio is a Messenger-only field; Instagram's template reference does not carry it.
  assert.equal("image_aspect_ratio" in template, false);
  assert.deepEqual(
    template.elements.map((element) => element.image_url),
    ["https://cdn.example.com/530-black.jpg", "https://cdn.example.com/530-white.jpg", "https://cdn.example.com/530-navy.jpg"]
  );
  assert.match(template.elements[0].title, /Black/);
  assert.match(template.elements[0].title, /850 جنيه/);
  assert.equal(template.elements[0].subtitle, "المقاسات: 40 | 41");
  assert.equal(template.elements[0].buttons[0].url, "https://m1store-egy.com/shop/product/530?color=Black");
});

test("Instagram never receives more than the ten elements a generic template allows", () => {
  const context = carouselContext();
  context.colorCards = Array.from({ length: 14 }, (_, index) =>
    colorCard(`Color${index}`, `https://cdn.example.com/530-${index}.jpg`, ["41"])
  );
  const plan = buildSocialCommentInstagramPrivateReplyPayload({ commentId: "1", normalizedContext: context });
  assert.equal(plan.mode, "color_carousel");
  assert.equal(plan.elements, 10);
  assert.equal(plan.payload.message.attachment.payload.elements.length, 10);
});

test("a single-colour product gets one product card carrying the price, the sizes and the link", () => {
  const context = { ...carouselContext(), carouselEligible: false, colorCards: [] };
  const plan = buildSocialCommentInstagramPrivateReplyPayload({ commentId: "42", normalizedContext: context });

  assert.equal(plan.mode, "product_card");
  assert.equal(plan.elements, 1);
  const [element] = plan.payload.message.attachment.payload.elements;
  assert.equal(element.title, "New Balance 530");
  assert.equal(element.image_url, "https://cdn.example.com/530-main.jpg");
  assert.match(element.subtitle, /السعر: 850 جنيه/);
  assert.match(element.subtitle, /المقاسات: 40 \| 41 \| 42/);
  assert.equal(element.buttons[0].url, "https://m1store-egy.com/shop/product/530");
});

test("with no photo at all there is no visual to send, so the text path stays", () => {
  const context = { ...carouselContext(), carouselEligible: false, colorCards: [], productImageUrl: "" };
  assert.equal(buildSocialCommentInstagramPrivateReplyPayload({ commentId: "42", normalizedContext: context }), null);
});

test("when the pictures cannot go out, the text stops pointing at cards and carries the facts itself", () => {
  const context = carouselContext();
  const original = buildPolishedSocialCommentProductReply({
    customerName: "أحمد",
    productContext: {
      __normalized_private_reply_context: true,
      productName: context.productName,
      priceUsed: context.priceUsed,
      availableSizes: context.availableSizes,
      availableSizesLabel: context.availableSizes.join(" | "),
      productLink: context.productLink,
      carouselEligible: true,
    },
  });
  assert.match(original, /دوس يمين وشمال على الكروت/);
  assert.match(original, /الأزرار تحت/);

  const recovered = restoreProductFactsToText({
    message: stripCardPointersFromText(original),
    productName: context.productName,
    productLink: context.productLink,
    priceUsed: context.priceUsed,
    availableSizes: context.availableSizes,
  });

  assert.equal(recovered.recoveredLines, 4);
  assert.doesNotMatch(recovered.text, /الكروت|الكارت|الأزرار تحت/);
  assert.match(recovered.text, /أهلاً بحضرتك يا أحمد/);
  assert.match(recovered.text, /New Balance 530/);
  assert.match(recovered.text, /السعر: 850 جنيه/);
  assert.match(recovered.text, /المقاسات المتاحة: 40 \| 41 \| 42/);
  assert.match(recovered.text, /https:\/\/m1store-egy\.com\/shop\/product\/530/);
});

test("a text that already carries the facts is left alone, and Messenger keeps its button line", () => {
  const already = "New Balance 530\nالسعر: 850 جنيه\nالمقاسات المتاحة: 40 | 41\nhttps://m1store-egy.com/shop/product/530";
  const untouched = restoreProductFactsToText({
    message: already,
    productName: "New Balance 530",
    productLink: "https://m1store-egy.com/shop/product/530",
    priceUsed: "850",
    availableSizes: ["40", "41"],
  });
  assert.equal(untouched.recoveredLines, 0);
  assert.equal(untouched.text, already);

  const withButtons = "أهلاً بحضرتك ✨\n\nعشان تشوف المقاسات المتاحة بصّ على الكارت فوق،\nواختار مقاسك من الأزرار تحت 👇\n\nمتاح شحن لجميع المحافظات";
  const kept = stripCardPointersFromText(withButtons, { keepSizeButtons: true });
  assert.doesNotMatch(kept, /الكارت فوق/);
  assert.match(kept, /واختار مقاسك من الأزرار تحت 👇/);
});
