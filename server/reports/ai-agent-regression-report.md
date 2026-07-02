# AI Agent Regression Report

- Total scenarios: 61
- Passed scenarios: 61
- Failed scenarios: 0
- Total steps: 119
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

## Group Summary
| Group | Pass Rate | Total | Passed | Failed |
| --- | --- | --- | --- | --- |
| Product Search | 100.0% | 15 | 15 | 0 |
| General | 100.0% | 3 | 3 | 0 |
| Alternatives | 100.0% | 8 | 8 | 0 |
| Stock Truth | 100.0% | 7 | 7 | 0 |
| Order Flow | 100.0% | 5 | 5 | 0 |
| Memory | 100.0% | 8 | 8 | 0 |
| Safety / Controls | 100.0% | 15 | 15 | 0 |

## Channel Summary
| Channel | Pass Rate | Total | Passed | Failed |
| --- | --- | --- | --- | --- |
| web_chat | 100.0% | 52 | 52 | 0 |
| whatsapp | 100.0% | 3 | 3 | 0 |
| facebook_messenger | 100.0% | 3 | 3 | 0 |
| instagram | 100.0% | 3 | 3 | 0 |

## Severity Summary
| Severity | Pass Rate | Total | Passed | Failed |
| --- | --- | --- | --- | --- |
| medium | 100.0% | 26 | 26 | 0 |
| critical | 100.0% | 22 | 22 | 0 |
| high | 100.0% | 13 | 13 | 0 |

## Top Failed Areas
No failed areas.

## Failures
No failures.
