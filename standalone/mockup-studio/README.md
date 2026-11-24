# JM Mockup Studio (standalone)

Public AI mockup tool for JM Digital Media. Users upload a logo, pick SanMar / S&S blanks (or upload a garment photo), and get mockups with the logo adjusted for each garment color.

Lives in the hat-order-site repo under `standalone/mockup-studio` and deploys as its own Vercel project (jm-mockup-studio, root directory = this folder). The UI is `components/MockupStudio.tsx` — a copy of `hat-order-site/components/MockupStudio.tsx`; copy it again when that one changes. All work runs on the hat-order-site API (`/api/mockup-studio/*`), which allows this app's origin via CORS. Set `NEXT_PUBLIC_MOCKUP_API` to point elsewhere. If this app gets another domain, add it to `MOCKUP_STUDIO_ORIGINS` on hat-order-site.
