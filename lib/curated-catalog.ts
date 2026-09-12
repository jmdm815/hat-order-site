import { getCatalog } from "./sanmar";
import { getCustomProducts } from "./custom-products-store";
import { getHiddenStyleNumbers } from "./catalog-selection";
import { getAllItemConfigs } from "./item-config-store";
import { getCategories } from "./categories-store";
import { Product, ProductType } from "./types";

const ALL_TYPES: ProductType[] = ["hat", "shirt", "polo", "tumbler"];

export type CuratedProduct = Product & {
  designEnabled: boolean;
  quoteEnabled: boolean;
};

export type CuratedCategory = {
  id: string;
  name: string;
  products: CuratedProduct[];
};

// The new catalog-first homepage: only products an admin has explicitly
// assigned to at least one Category show up here (see
// CatalogItemConfig.categoryIds in lib/types.ts) — unlike /api/catalog,
// which returns everything of a given SanMar productType minus hidden
// styles. Shared between app/page.tsx (server component, calls this
// directly) and app/api/catalog/curated/route.ts (kept for any client-side
// consumer that needs it over HTTP, e.g. an admin preview).
export async function getCuratedCatalog(): Promise<CuratedCategory[]> {
  const [catalogsByType, customProducts, hidden, configs, categories] = await Promise.all([
    Promise.all(ALL_TYPES.map((t) => getCatalog(t))),
    getCustomProducts(),
    getHiddenStyleNumbers(),
    getAllItemConfigs(),
    getCategories(),
  ]);

  const allProducts: Product[] = [...catalogsByType.flat(), ...customProducts].filter(
    (p) => !hidden.has(p.styleNumber)
  );

  return categories
    .map((cat) => {
      const products: CuratedProduct[] = allProducts
        .filter((p) => configs[p.styleNumber]?.categoryIds?.includes(cat.id))
        .map((p) => {
          const cfg = configs[p.styleNumber];
          return {
            ...p,
            designEnabled: cfg?.designEnabled !== false,
            quoteEnabled: cfg?.quoteEnabled !== false,
          };
        });
      return { id: cat.id, name: cat.name, products };
    })
    .filter((c) => c.products.length > 0);
}
