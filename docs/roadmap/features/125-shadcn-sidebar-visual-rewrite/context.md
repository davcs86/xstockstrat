# Context: shadcn-sidebar-visual-rewrite

**Feature**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/feature.md`
**Product Spec**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/125-shadcn-sidebar-visual-rewrite/implementation-spec.md`

---

## Session 2026-08-10T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from a user story delivered as a
  chat instruction with an attached screen recording ("create a followup feature to rewrite the
  sidebar menu. I'm attaching the Shadcn example vs what we have implemented").
- The video could not be read directly (unsupported media type for the Read tool); extracted 14
  representative frames via Python/OpenCV (`opencv-python-headless`, `cv2.VideoCapture` +
  `cap.set(cv2.CAP_PROP_POS_FRAMES, idx)`) and viewed them via Read to compare our live mobile
  offcanvas Sidebar against shadcn's own reference example.
- Findings grounded directly in feature 124's own implementation: `ui/sidebar.tsx` (vendored Step
  15) already exports `SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton`, but Step 17's
  `PlatformHeader.tsx` wiring never used them — sub-items render via the same flat
  `SidebarMenu`/`SidebarMenuItem` primitives as top-level groups, with no chevron and no
  indentation cue. This is the exact gap the video comparison surfaced.
- Read `docs/runbooks/feature-workflow.md` and `docs/runbooks/reviewer-registry.md` for governance
  gates and reviewer roles (UI-only, non-breaking → 1 service owner approval, same
  `xstockstrat-ui` service owner role feature 124 used).
- Read `docs/roadmap/ledger/fails.md` (page 1) and `docs/roadmap/ledger/insights.md` (page 1), then
  a targeted grep for `shadcn-table-actions-responsive|SidebarProvider|Sidebar collapsible|
  min-h-svh` across both ledger files found one directly relevant entry:
  `insights.md`'s `2026-08-09 — shadcn-table-actions-responsive — design` — a process lesson (not
  a Sidebar-technical one) that mid-round design decisions must be written into
  `recon.md`/`context.md` before the next debate round spawns, or a later adversary reading only
  the durable artifacts will raise a false-alarm regression. Surfaced this as a "Known trap" in
  the product spec's Open Questions since it hit this exact feature family (124) once already.
  `fails.md` had no matching entries for this scope.
- Out-of-scope items (org/team switcher, user-account footer, icon-collapse desktop rail mode, and
  a "More" overflow affordance given the current small item count) recorded explicitly in the
  product spec rather than left implicit, per the user's own framing of the request ("confirm
  during design").
- **User correction**: "the always visible is not the point, but the layout and interaction are" —
  sharpened the Problem Statement and the icon-collapse-rail Out of Scope bullet so the spec can't
  be misread as asking for a persistently-visible/desktop-rail Sidebar. The scope is layout
  (chevron disclosure affordance, `SidebarMenuSub`-based nesting/indentation, section-label
  grouping) and interaction (chevron rotation on toggle) within the existing mobile-offcanvas
  surface — visibility/placement (offcanvas vs. rail) is a separate, explicitly out-of-scope axis.
  No FRs changed; this was a framing/emphasis fix, not a scope fix.
