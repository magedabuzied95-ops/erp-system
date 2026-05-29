# AI Agent Sales Flow QA

Use this checklist before changing the Tiger Store AI Agent sales/order flow.

## Automated Harness

Run:

```bash
node server/scripts/qaAiAgentSalesFlow.js
```

Expected output:

```text
[qa:ai-agent-sales-flow] all scenarios passed
```

## Manual Storefront Chat Checks

Use a fresh storefront chat session unless the scenario says to reuse the same session.

### 1. Product Price Question

Customer message:

```text
جوردن فور بكام؟
```

Expected AI reply:
- Leads with product price and availability.
- May mention a short benefit/value line.
- May show available sizes/colors.
- Must not ask for name, phone, or address.

Expected backend state:
- No AI order draft.
- `conversation_stage` should be `product_discussion` or the generic product answer path.

Logs to check:
- No `[ai-agent:sales-flow] draft_created`.

### 2. Availability Question

Customer message:

```text
متاح مقاس 42؟
```

Expected AI reply:
- Answers availability naturally.
- Mentions stock/availability context for size 42 if known.
- Must not collect customer data.

Expected backend state:
- No AI order draft.
- No phone/address capture.

### 3. Objection Handling

Customer message:

```text
السعر غالي
```

Expected AI reply:
- Handles objection naturally.
- Should explain value or offer cheaper alternatives.
- Must not create draft.
- Must not ask for phone/address.

Expected backend state:
- `conversation_stage` should be `objection_handling` when handled by order/sales flow.

Logs to check:
- `[ai-agent:sales-flow]` with `event: objection_handling`.

### 3A. Visual Selling Requests

Customer messages:

```text
ابعت صور
عايز أشوفها
وريني
فيه ألوان؟
شكلها عامل إيه؟
المقاسات؟
دليل المقاسات
تلبس على إيه؟
complete the look
```

Expected AI reply:
- Keeps normal sales tone.
- Does not ask for name, phone, or address.
- Does not create an order draft.
- Includes `visual_attachments` when matching storefront images or size data exist.

Expected visual payload:
- Product/photo requests return `product_image_cards`.
- Color requests return `variant_color_cards` when variant/color images exist.
- Size requests return `size_guide` with available sizes or size data.
- Similar/cheaper/complete-look requests return product carousel style attachments when matching products have images.

Expected storefront UI:
- Image cards render inside the chat bubble.
- Multiple products render as a horizontal carousel.
- Size guide renders as a compact size card.
- If no image exists, the text reply still works and chat does not break.

Expected AI Inbox:
- The latest conversation card shows visual attachment previews under the AI answer.

Logs to check:
- `ai_support_messages.visual_attachments` contains only existing storefront image URLs or size data.
- No `[ai-agent:sales-flow] draft_created` for visual-only messages.

### 4. Clear Buying Intent

Customer message:

```text
تمام هاخده
```

Expected AI reply:
- Transitions into order collection only now.
- If customer name is missing, asks exactly:

```text
تشرفنا ❤️ ممكن أعرف اسم حضرتك؟
```

Expected backend state:
- No draft yet.
- `conversation_stage` should be `collecting_name`.

### 5. Name-First Flow

Customer message after name prompt:

```text
أحمد
```

Expected AI reply:
- Uses/saves the name.
- Asks only the next missing field, usually phone.
- Does not ask for address in the same message.

Expected backend state:
- Session/memory should contain customer name.
- No draft yet unless all other required fields are already known.

### 6. Known Customer Data

Prepare session/memory or metadata with:
- name
- phone
- address
- selected product
- selected variant/size

Customer message:

```text
تمام هاخده
```

Expected AI reply:
- Does not ask again for known data.
- Creates draft only if product, variant, quantity, name, phone, and address are all present and valid.

### 7. Draft Creation

Use a session where all required data is available:
- product
- variant/size/color
- quantity
- customer name
- valid Egyptian phone
- address

Expected backend state:
- One order with `ai_agent_status = ai_draft`.
- Order item `price`, `sale_price`, and `total_amount` use actual selling price only.
- Must not use `regular_price` or compare/old price in draft totals.

Logs to check:
- `[ai-agent:sales-flow]` with `event: draft_created`.
- `[ai-agent:orders] draft created`.

### 8. Duplicate Prevention

Repeat in the same conversation:

```text
تمام هاخده
```

Expected backend state:
- No duplicate draft for the same conversation/product/variant/phone intent.
- Existing draft is reused or duplicate flag is returned.

### 9. Stock Conflict

Create a draft, then reduce selected variant stock to zero before confirm.

Customer message:

```text
اكد
```

Expected AI/backend behavior:
- Confirm revalidates stock.
- Confirmation should fail safely.
- AI should suggest alternative or handoff.
- No stock should be deducted below zero.

Logs to check:
- `[ai-agent:orders] confirm failed` with stock conflict code.

### 10. Handoff Cases

Customer messages:

```text
فيه خصم؟
ينفع استبدال؟
أنا زعلان من الطلب
```

Expected AI reply:
- Discount/manual price and exchange/return complaints should not create draft.
- Complaint/angry customer should hand off to a human.

Expected backend state:
- `conversation_stage` should be `handoff` where deterministic order flow handles it.
- No order draft unless the customer later gives clear buying intent and all required data.

Logs to check:
- `[ai-agent:sales-flow]` with `event: handoff`.
