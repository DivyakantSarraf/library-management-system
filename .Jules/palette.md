## 2023-10-25 - [Accessibility] Missing ARIA labels on search inputs
**Learning:** Found a recurring pattern where search inputs across the application (in the topbar and admin pages like books, issues, and members) were lacking `aria-label` attributes, which makes them inaccessible to screen readers since they also lack explicit `<label>` tags.
**Action:** Consistently check for and add `aria-label` to all search `<input>` fields that don't have visible, associated text labels to ensure full accessibility for screen reader users.
