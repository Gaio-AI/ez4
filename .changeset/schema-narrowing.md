---
'@ez4/schema': minor
---

Intersections follow TypeScript: `Base & { kind: 'image' | 'video' }` narrows the enum (an enum and one of its literals give the literal), a property stays optional or nullable only when both sides allow it, `interface X extends Y` keeps `Y`'s properties, and `Object & (A | B)` builds the distributed union instead of throwing `InvalidSchemaIntersection`.
