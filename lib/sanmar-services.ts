// ---------------------------------------------------------------------------
// SanMar PromoStandards web services used by the SanMar Order page
// (app/admin/sanmar-order): live inventory by warehouse, order status and
// shipment tracking. Same SANMAR_USERNAME / SANMAR_PASSWORD as the pricing
// service (lib/sanmar-pricing.ts). Wire formats confirmed against the live
// service with /api/admin/sanmar-api-debug (Nov 2026).
//
// Never throws: every function returns null on failure so the page can show
// "couldn't reach SanMar" instead of breaking.
// ---------------------------------------------------------------------------

const BASE = "https://ws.sanmar.com:8080/promostandards";

function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function creds() {
  const id = process.env.SANMAR_USERNAME;
  const pw = process.env.SANMAR_PASSWORD;
  return id && pw ? { id: esc(id), pw: esc(pw) } : null;
}

async function soap(path: string, action: string, body: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: action },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`sanmar-services ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
      return null;
    }
    return text;
  } catch (err) {
    console.error(`sanmar-services ${path}: request failed`, err);
    return null;
  }
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<(?:[\\w-]+:)?${name}>([^<]*)</(?:[\\w-]+:)?${name}>`));
  return m ? m[1].trim() : undefined;
}

function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${name}>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function errorMessage(xml: string): string | undefined {
  const err = blocks(xml, "errorMessage")[0] ?? blocks(xml, "ServiceMessage")[0];
  if (!err) return undefined;
  return tag(err, "description");
}

// ---- Inventory ------------------------------------------------------------

export type SanmarWarehouseQty = { id: string; name: string; qty: number };
export type SanmarPartInventory = {
  partId: string;
  color: string;
  size: string;
  total: number;
  warehouses: SanmarWarehouseQty[];
};

const invCache = new Map<string, { at: number; parts: SanmarPartInventory[] }>();
const INV_TTL = 3 * 60 * 1000;

/** Live stock for every color/size of a style, by warehouse. Optional color filter. */
export async function getSanmarInventory(style: string, color?: string): Promise<SanmarPartInventory[] | null> {
  const c = creds();
  if (!c) return null;
  const key = style.toUpperCase();
  const hit = invCache.get(key);
  let parts = hit && Date.now() - hit.at < INV_TTL ? hit.parts : null;
  if (!parts) {
    const xml = await soap(
      "InventoryServiceBindingV2final",
      "getInventoryLevels",
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.promostandards.org/WSDL/Inventory/2.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/Inventory/2.0.0/SharedObjects/"><soapenv:Header/><soapenv:Body><ns:GetInventoryLevelsRequest><shar:wsVersion>2.0.0</shar:wsVersion><shar:id>${c.id}</shar:id><shar:password>${c.pw}</shar:password><shar:productId>${esc(style)}</shar:productId></ns:GetInventoryLevelsRequest></soapenv:Body></soapenv:Envelope>`
    );
    if (!xml) return null;
    parts = blocks(xml, "PartInventory").map((b) => {
      const qtyBlock = blocks(b, "quantityAvailable")[0] ?? "";
      return {
        partId: tag(b, "partId") ?? "",
        color: tag(b, "partColor") ?? "",
        size: tag(b, "labelSize") ?? "",
        total: Number(tag(qtyBlock, "value")) || 0,
        warehouses: blocks(b, "InventoryLocation").map((l) => ({
          id: tag(l, "inventoryLocationId") ?? "",
          name: tag(l, "inventoryLocationName") ?? "",
          qty: Number(tag(blocks(l, "inventoryLocationQuantity")[0] ?? "", "value")) || 0,
        })),
      };
    });
    if (!parts.length) {
      console.error(`getSanmarInventory(${style}): no parts — ${errorMessage(xml) ?? "unknown"}`);
      return null;
    }
    invCache.set(key, { at: Date.now(), parts });
  }
  if (!color) return parts;
  const want = color.toLowerCase();
  return parts.filter((p) => p.color.toLowerCase() === want);
}

// ---- Order status ---------------------------------------------------------

export type SanmarOrderStatus = {
  salesOrder: string;
  purchaseOrder?: string;
  status: string;
  statusId: string;
  expectedShipDate?: string;
  updatedAt?: string;
};

/** Orders whose status changed since `sinceIso` (SanMar returns roughly the last few weeks). */
export async function getSanmarOrderStatuses(sinceIso: string): Promise<SanmarOrderStatus[] | null> {
  const c = creds();
  if (!c) return null;
  const xml = await soap(
    "OrderStatusServiceBinding",
    "getOrderStatusDetails",
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.promostandards.org/WSDL/OrderStatusService/1.0.0/"><soapenv:Header/><soapenv:Body><ns:GetOrderStatusDetailsRequest><ns:wsVersion>1.0.0</ns:wsVersion><ns:id>${c.id}</ns:id><ns:password>${c.pw}</ns:password><ns:queryType>3</ns:queryType><ns:statusTimeStamp>${esc(sinceIso.slice(0, 19))}</ns:statusTimeStamp></ns:GetOrderStatusDetailsRequest></soapenv:Body></soapenv:Envelope>`
  );
  if (!xml) return null;
  const out: SanmarOrderStatus[] = [];
  for (const os of blocks(xml, "OrderStatus")) {
    const po = tag(os, "purchaseOrderNumber");
    for (const d of blocks(os, "OrderStatusDetail")) {
      out.push({
        salesOrder: tag(d, "factoryOrderNumber") ?? "",
        purchaseOrder: po && po !== "NOT AVAILABLE" ? po : undefined,
        status: tag(d, "statusName") ?? "",
        statusId: tag(d, "statusID") ?? "",
        expectedShipDate: tag(d, "expectedShipDate"),
        updatedAt: tag(d, "validTimestamp"),
      });
    }
  }
  if (!out.length) {
    const msg = errorMessage(xml);
    if (msg && !/no.*found|not found/i.test(msg)) console.error(`getSanmarOrderStatuses: ${msg}`);
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

// ---- Shipments ------------------------------------------------------------

export type SanmarShipment = {
  salesOrder: string;
  shipDate?: string;
  carrier?: string;
  service?: string;
  tracking: string[];
  fromWarehouse?: string;
};

function parseShipments(xml: string): SanmarShipment[] {
  const out: SanmarShipment[] = [];
  for (const so of blocks(xml, "SalesOrder")) {
    const salesOrder = tag(so, "salesOrderNumber") ?? "";
    for (const loc of blocks(so, "ShipmentLocation")) {
      const from = blocks(loc, "ShipFromAddress")[0];
      const packages = blocks(loc, "Package");
      const tracking = packages.map((p) => tag(p, "trackingNumber")).filter((t): t is string => Boolean(t));
      const first = packages[0] ?? "";
      out.push({
        salesOrder,
        shipDate: tag(first, "shipmentDate"),
        carrier: tag(first, "carrier"),
        service: tag(first, "shipmentMethod"),
        tracking: Array.from(new Set(tracking)),
        fromWarehouse: from ? [tag(from, "city"), tag(from, "region")].filter(Boolean).join(", ") : undefined,
      });
    }
  }
  return out;
}

/** Tracking for one SanMar sales order (SO number, digits only). */
export async function getSanmarShipmentsForOrder(salesOrder: string): Promise<SanmarShipment[] | null> {
  const c = creds();
  if (!c) return null;
  const xml = await soap(
    "OrderShipmentNotificationServiceBinding",
    "getOrderShipmentNotification",
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.promostandards.org/WSDL/OrderShipmentNotificationService/1.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/OrderShipmentNotificationService/1.0.0/SharedObjects/"><soapenv:Header/><soapenv:Body><ns:GetOrderShipmentNotificationRequest><shar:wsVersion>1.0.0</shar:wsVersion><shar:id>${c.id}</shar:id><shar:password>${c.pw}</shar:password><ns:queryType>2</ns:queryType><ns:referenceNumber>${esc(salesOrder.replace(/\D/g, ""))}</ns:referenceNumber></ns:GetOrderShipmentNotificationRequest></soapenv:Body></soapenv:Envelope>`,
    15000
  );
  if (!xml) return null;
  return parseShipments(xml);
}
