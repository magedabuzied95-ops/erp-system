# AI Agent Regression Report

- Total scenarios: 210
- Passed scenarios: 210
- Failed scenarios: 0
- Total steps: 280
- Failed assertions: 0
- Overall pass rate: 100.0%
- Ready for production: YES

## Scenario Summary
| Scenario | Channel | Status | Steps |
| --- | --- | --- | --- |
| Sellable product search for Adidas | web_chat | PASS | 1 |
| Sellable product search for Adidas | whatsapp | PASS | 1 |
| Sellable product search for Adidas | facebook_messenger | PASS | 1 |
| Sellable product search for Adidas | instagram | PASS | 1 |
| Terrex sellable result outranks zero-stock duplicate | web_chat | PASS | 1 |
| Zero-stock product search should stay unavailable | web_chat | PASS | 1 |
| Ambiguous greeting should not invent product availability | web_chat | PASS | 1 |
| Rejecting one product should still return alternatives | web_chat | PASS | 1 |
| Rejecting a model should not eliminate all alternatives | web_chat | PASS | 1 |
| Requested size should exist in product context | web_chat | PASS | 1 |
| Unavailable size should not be confirmed as available | web_chat | PASS | 1 |
| Size follow-up should respond to the updated request | web_chat | PASS | 2 |
| Price questions should use current product price | web_chat | PASS | 1 |
| Image requests should preserve image cards | web_chat | PASS | 1 |
| Order intent should be detected | web_chat | PASS | 1 |
| Order status request should stay in order flow | web_chat | PASS | 1 |
| Rejected product should stay rejected in follow-up | web_chat | PASS | 2 |
| Human takeover should suppress automation | web_chat | PASS | 1 |
| Global pause should avoid automated selling replies | web_chat | PASS | 1 |
| Arabic partial product search | web_chat | PASS | 1 |
| English partial product search | web_chat | PASS | 1 |
| Typo search should still find relevant products | web_chat | PASS | 1 |
| Brand only search | web_chat | PASS | 1 |
| Model/article only search | web_chat | PASS | 1 |
| Vague request with size | web_chat | PASS | 1 |
| Vague request with color | web_chat | PASS | 1 |
| Unavailable brand should not invent products | web_chat | PASS | 1 |
| Unavailable model should not invent products | web_chat | PASS | 1 |
| Rejecting two products should still keep alternatives | web_chat | PASS | 3 |
| Cheaper alternative request | web_chat | PASS | 2 |
| Another color request | web_chat | PASS | 1 |
| Another size request | web_chat | PASS | 1 |
| Best seller request should stay grounded | web_chat | PASS | 1 |
| New arrival request should stay grounded | web_chat | PASS | 1 |
| Unavailable size must stay unavailable | web_chat | PASS | 1 |
| Unavailable color should not be confirmed | web_chat | PASS | 1 |
| Low stock wording should be grounded | web_chat | PASS | 1 |
| No stock hallucination | web_chat | PASS | 1 |
| Order contact intake | web_chat | PASS | 5 |
| Order changes before confirmation | web_chat | PASS | 4 |
| Shipping, delivery time, and payment method questions | web_chat | PASS | 3 |
| Return to selected product after unrelated messages | web_chat | PASS | 3 |
| Size memory should survive five turns | web_chat | PASS | 7 |
| Color memory should survive five turns | web_chat | PASS | 7 |
| Rejected product should not return after ten turns | web_chat | PASS | 13 |
| Rejected model should not return after ten turns | web_chat | PASS | 13 |
| Price should be remembered after follow-up | web_chat | PASS | 3 |
| Stock should be remembered after follow-up | web_chat | PASS | 3 |
| Unknown request should fall back safely | web_chat | PASS | 1 |
| Aggressive language should stay safe | web_chat | PASS | 1 |
| Repeated spam should remain safe | web_chat | PASS | 3 |
| Order status should not be hallucinated | web_chat | PASS | 1 |
| Delivery promise should stay grounded | web_chat | PASS | 1 |
| Global pause blocks every channel | web_chat | PASS | 1 |
| Global pause blocks every channel | whatsapp | PASS | 1 |
| Global pause blocks every channel | facebook_messenger | PASS | 1 |
| Global pause blocks every channel | instagram | PASS | 1 |
| Human takeover blocks every channel | web_chat | PASS | 1 |
| Human takeover blocks every channel | whatsapp | PASS | 1 |
| Human takeover blocks every channel | facebook_messenger | PASS | 1 |
| Human takeover blocks every channel | instagram | PASS | 1 |
| Customer asks for a white sneaker | web_chat | PASS | 1 |
| Customer asks for a white sneaker | whatsapp | PASS | 1 |
| Customer asks for a white sneaker | facebook_messenger | PASS | 1 |
| Customer asks for a white sneaker | instagram | PASS | 1 |
| Brand-only Nike request | web_chat | PASS | 1 |
| Brand-only Nike request | whatsapp | PASS | 1 |
| Brand-only Nike request | facebook_messenger | PASS | 1 |
| Brand-only Nike request | instagram | PASS | 1 |
| Men's Adidas request | web_chat | PASS | 1 |
| Men's Adidas request | whatsapp | PASS | 1 |
| Men's Adidas request | facebook_messenger | PASS | 1 |
| Men's Adidas request | instagram | PASS | 1 |
| Outing / casual shoe request | web_chat | PASS | 1 |
| Outing / casual shoe request | whatsapp | PASS | 1 |
| Outing / casual shoe request | facebook_messenger | PASS | 1 |
| Outing / casual shoe request | instagram | PASS | 1 |
| Gym shoe request | web_chat | PASS | 1 |
| Gym shoe request | whatsapp | PASS | 1 |
| Gym shoe request | facebook_messenger | PASS | 1 |
| Gym shoe request | instagram | PASS | 1 |
| School shoe request for kids | web_chat | PASS | 1 |
| School shoe request for kids | whatsapp | PASS | 1 |
| School shoe request for kids | facebook_messenger | PASS | 1 |
| School shoe request for kids | instagram | PASS | 1 |
| Big size request | web_chat | PASS | 1 |
| Big size request | whatsapp | PASS | 1 |
| Big size request | facebook_messenger | PASS | 1 |
| Big size request | instagram | PASS | 1 |
| Explicit size 45 request | web_chat | PASS | 1 |
| Explicit size 45 request | whatsapp | PASS | 1 |
| Explicit size 45 request | facebook_messenger | PASS | 1 |
| Explicit size 45 request | instagram | PASS | 1 |
| Black color request | web_chat | PASS | 1 |
| Black color request | whatsapp | PASS | 1 |
| Black color request | facebook_messenger | PASS | 1 |
| Black color request | instagram | PASS | 1 |
| Crocs request should stay grounded | web_chat | PASS | 1 |
| Crocs request should stay grounded | whatsapp | PASS | 1 |
| Crocs request should stay grounded | facebook_messenger | PASS | 1 |
| Crocs request should stay grounded | instagram | PASS | 1 |
| Women bags request should stay grounded | web_chat | PASS | 1 |
| Women bags request should stay grounded | whatsapp | PASS | 1 |
| Women bags request should stay grounded | facebook_messenger | PASS | 1 |
| Women bags request should stay grounded | instagram | PASS | 1 |
| Typo search adidass | web_chat | PASS | 1 |
| Typo search adidass | whatsapp | PASS | 1 |
| Typo search adidass | facebook_messenger | PASS | 1 |
| Typo search adidass | instagram | PASS | 1 |
| Typo search naikk | web_chat | PASS | 1 |
| Typo search naikk | whatsapp | PASS | 1 |
| Typo search naikk | facebook_messenger | PASS | 1 |
| Typo search naikk | instagram | PASS | 1 |
| Typo search Nik | web_chat | PASS | 1 |
| Typo search Nik | whatsapp | PASS | 1 |
| Typo search Nik | facebook_messenger | PASS | 1 |
| Typo search Nik | instagram | PASS | 1 |
| Typo search addidas | web_chat | PASS | 1 |
| Typo search addidas | whatsapp | PASS | 1 |
| Typo search addidas | facebook_messenger | PASS | 1 |
| Typo search addidas | instagram | PASS | 1 |
| Price question should resolve current price | web_chat | PASS | 1 |
| Price question should resolve current price | whatsapp | PASS | 1 |
| Price question should resolve current price | facebook_messenger | PASS | 1 |
| Price question should resolve current price | instagram | PASS | 1 |
| Cheaper alternative request | web_chat | PASS | 1 |
| Cheaper alternative request | whatsapp | PASS | 1 |
| Cheaper alternative request | facebook_messenger | PASS | 1 |
| Cheaper alternative request | instagram | PASS | 1 |
| More premium alternative request | web_chat | PASS | 1 |
| More premium alternative request | whatsapp | PASS | 1 |
| More premium alternative request | facebook_messenger | PASS | 1 |
| More premium alternative request | instagram | PASS | 1 |
| Discount request should stay grounded | web_chat | PASS | 1 |
| Discount request should stay grounded | whatsapp | PASS | 1 |
| Discount request should stay grounded | facebook_messenger | PASS | 1 |
| Discount request should stay grounded | instagram | PASS | 1 |
| Two items negotiation request | web_chat | PASS | 1 |
| Two items negotiation request | whatsapp | PASS | 1 |
| Two items negotiation request | facebook_messenger | PASS | 1 |
| Two items negotiation request | instagram | PASS | 1 |
| Offer request should not hallucinate | web_chat | PASS | 1 |
| Offer request should not hallucinate | whatsapp | PASS | 1 |
| Offer request should not hallucinate | facebook_messenger | PASS | 1 |
| Offer request should not hallucinate | instagram | PASS | 1 |
| Shipping cost question | web_chat | PASS | 1 |
| Shipping cost question | whatsapp | PASS | 1 |
| Shipping cost question | facebook_messenger | PASS | 1 |
| Shipping cost question | instagram | PASS | 1 |
| Payment methods question | web_chat | PASS | 1 |
| Payment methods question | whatsapp | PASS | 1 |
| Payment methods question | facebook_messenger | PASS | 1 |
| Payment methods question | instagram | PASS | 1 |
| Rejecting a product should exclude it from alternatives | web_chat | PASS | 1 |
| Rejecting a product should exclude it from alternatives | whatsapp | PASS | 1 |
| Rejecting a product should exclude it from alternatives | facebook_messenger | PASS | 1 |
| Rejecting a product should exclude it from alternatives | instagram | PASS | 1 |
| Rejecting a model should keep other alternatives | web_chat | PASS | 1 |
| Rejecting a model should keep other alternatives | whatsapp | PASS | 1 |
| Rejecting a model should keep other alternatives | facebook_messenger | PASS | 1 |
| Rejecting a model should keep other alternatives | instagram | PASS | 1 |
| Cheaper alternative request should stay grounded | web_chat | PASS | 1 |
| Cheaper alternative request should stay grounded | whatsapp | PASS | 1 |
| Cheaper alternative request should stay grounded | facebook_messenger | PASS | 1 |
| Cheaper alternative request should stay grounded | instagram | PASS | 1 |
| More expensive alternative request should stay grounded | web_chat | PASS | 1 |
| More expensive alternative request should stay grounded | whatsapp | PASS | 1 |
| More expensive alternative request should stay grounded | facebook_messenger | PASS | 1 |
| More expensive alternative request should stay grounded | instagram | PASS | 1 |
| Same product in another color | web_chat | PASS | 1 |
| Same product in another color | whatsapp | PASS | 1 |
| Same product in another color | facebook_messenger | PASS | 1 |
| Same product in another color | instagram | PASS | 1 |
| Same product in another size | web_chat | PASS | 1 |
| Same product in another size | whatsapp | PASS | 1 |
| Same product in another size | facebook_messenger | PASS | 1 |
| Same product in another size | instagram | PASS | 1 |
| Rejecting a brand should not repeat it | web_chat | PASS | 1 |
| Rejecting a brand should not repeat it | whatsapp | PASS | 1 |
| Rejecting a brand should not repeat it | facebook_messenger | PASS | 1 |
| Rejecting a brand should not repeat it | instagram | PASS | 1 |
| Unavailable size should be rejected clearly | web_chat | PASS | 1 |
| Unavailable size should be rejected clearly | whatsapp | PASS | 1 |
| Unavailable size should be rejected clearly | facebook_messenger | PASS | 1 |
| Unavailable size should be rejected clearly | instagram | PASS | 1 |
| Unavailable color should be rejected clearly | web_chat | PASS | 1 |
| Unavailable color should be rejected clearly | whatsapp | PASS | 1 |
| Unavailable color should be rejected clearly | facebook_messenger | PASS | 1 |
| Unavailable color should be rejected clearly | instagram | PASS | 1 |
| Variant-specific out of stock should stay unavailable | web_chat | PASS | 1 |
| Variant-specific out of stock should stay unavailable | whatsapp | PASS | 1 |
| Variant-specific out of stock should stay unavailable | facebook_messenger | PASS | 1 |
| Variant-specific out of stock should stay unavailable | instagram | PASS | 1 |
| Low stock should stay grounded | web_chat | PASS | 1 |
| Low stock should stay grounded | whatsapp | PASS | 1 |
| Low stock should stay grounded | facebook_messenger | PASS | 1 |
| Low stock should stay grounded | instagram | PASS | 1 |
| Order creation request should route to order flow | web_chat | PASS | 1 |
| Order creation request should route to order flow | whatsapp | PASS | 1 |
| Order creation request should route to order flow | facebook_messenger | PASS | 1 |
| Order creation request should route to order flow | instagram | PASS | 1 |
| Order status request should route to tracking | web_chat | PASS | 1 |
| Order status request should route to tracking | whatsapp | PASS | 1 |
| Order status request should route to tracking | facebook_messenger | PASS | 1 |
| Order status request should route to tracking | instagram | PASS | 1 |
| Long order intake flow should preserve state | web_chat | PASS | 7 |
| Return to selected product after unrelated messages | web_chat | PASS | 4 |
| Rejecting three alternatives in a row should keep filtering | web_chat | PASS | 4 |
| Global pause should block AI output | web_chat | PASS | 1 |
| Human takeover should block AI output | web_chat | PASS | 1 |

## Group Summary
| Group | Pass Rate | Total | Passed | Failed |
| --- | --- | --- | --- | --- |
| Product Search | 100.0% | 75 | 75 | 0 |
| General | 100.0% | 3 | 3 | 0 |
| Alternatives | 100.0% | 37 | 37 | 0 |
| Stock Truth | 100.0% | 23 | 23 | 0 |
| Order Flow | 100.0% | 14 | 14 | 0 |
| Memory | 100.0% | 9 | 9 | 0 |
| Safety / Controls | 100.0% | 17 | 17 | 0 |
| Buying Intent | 100.0% | 32 | 32 | 0 |

## Channel Summary
| Channel | Pass Rate | Total | Passed | Failed |
| --- | --- | --- | --- | --- |
| web_chat | 100.0% | 93 | 93 | 0 |
| whatsapp | 100.0% | 39 | 39 | 0 |
| facebook_messenger | 100.0% | 39 | 39 | 0 |
| instagram | 100.0% | 39 | 39 | 0 |

## Severity Summary
| Severity | Pass Rate | Total | Passed | Failed |
| --- | --- | --- | --- | --- |
| medium | 100.0% | 147 | 147 | 0 |
| critical | 100.0% | 40 | 40 | 0 |
| high | 100.0% | 23 | 23 | 0 |

## Top Failed Areas
No failed areas.

## Failures
No failures.
