# Advertising Suggestion

## Goal
Fill the right-side advertiser lane with high-trust paid links that feel relevant to repair workflows and do not degrade the user experience.

## Best Layout For This Lane
- Use 3 stacked sponsor cards max at one time.
- Keep one primary sponsor in the top slot.
- Use two rotating secondary sponsors under it.
- Keep card height consistent to avoid layout jump.

## Recommended Slot Structure
1. Top sponsor (premium)
- Headline (max 42 chars)
- 1-line value claim
- CTA link

2. Mid sponsor (standard)
- Brand name
- Offer snippet
- CTA link

3. Bottom sponsor (standard)
- Brand name
- Offer snippet
- CTA link

## Link Policy
- Open links in a new tab.
- Mark links with rel="sponsored noopener noreferrer".
- Label each card clearly as Sponsored.
- Reject misleading or low-trust advertiser claims.

## Categories That Fit This Product
- Tool retailers (hand tools, test tools)
- Parts suppliers (OEM and compatible)
- Safety gear (gloves, eye protection)
- Home service marketplaces (for escalation)
- Warranty/repair membership offers

## Pricing And Inventory Model
- Top slot: fixed weekly fee + optional CPC bonus.
- Mid and bottom slots: CPC or CPM.
- Offer minimum 2-week booking windows.
- Cap active advertisers per lane to preserve quality.

## Performance Tracking
Track at least:
- impressions
- clicks
- CTR
- effective revenue per 1000 views
- conversion feedback (if advertiser can provide)

Use a weekly report to decide:
- keep
- rotate
- remove
- raise/lower price

## UX Guardrails
- Do not auto-expand cards.
- Do not use flashing animation.
- Keep lane visually lighter than primary repair content.
- Keep ad copy short and scannable.
- Maintain clear visual separation from core app controls.

## Suggested Next Implementation
- Add an advertiser config JSON with slot priority, status, and links.
- Add simple rotation logic for mid/bottom slots by view count.
- Add click + impression endpoint for reporting.
