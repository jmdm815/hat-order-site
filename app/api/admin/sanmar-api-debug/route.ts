import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";

// GET /api/admin/sanmar-api-debug?svc=inventory|inventory-std|status|shipment[&style=PC54][&since=2026-11-01T00:00:00][&endpoint=...]
// Admin-only probe of SanMar's inventory / order-status / shipment web services.
// Returns HTTP status and the first part of the raw SOAP response (credentials
// are never echoed back) so the real wire format can be confirmed.

const BASE = "https://ws.sanmar.com:8080";

function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function envelope(svc: string, p: URLSearchParams) {
  const id = esc(process.env.SANMAR_USERNAME ?? "");
  const pw = esc(process.env.SANMAR_PASSWORD ?? "");
  const acct = esc(process.env.SANMAR_ACCOUNT ?? "");
  const style = esc(p.get("style") ?? "PC54");
  const since = esc(p.get("since") ?? new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 19));
  switch (svc) {
    case "inventory":
      return {
        url: `${BASE}/promostandards/InventoryServiceBindingV2final`,
        action: "getInventoryLevels",
        body: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.promostandards.org/WSDL/Inventory/2.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/Inventory/2.0.0/SharedObjects/"><soapenv:Header/><soapenv:Body><ns:GetInventoryLevelsRequest><shar:wsVersion>2.0.0</shar:wsVersion><shar:id>${id}</shar:id><shar:password>${pw}</shar:password><shar:productId>${style}</shar:productId></ns:GetInventoryLevelsRequest></soapenv:Body></soapenv:Envelope>`,
      };
    case "inventory-std":
      return {
        url: `${BASE}/SanMarWebService/SanMarWebServicePort`,
        action: "",
        body: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webservice.integration.sanmar.com/"><soapenv:Header/><soapenv:Body><web:getInventoryQtyForStyleColorSize><arg0>${acct}</arg0><arg1>${id}</arg1><arg2>${pw}</arg2><arg3>${style}</arg3><arg4>${esc(p.get("color") ?? "")}</arg4><arg5>${esc(p.get("size") ?? "")}</arg5></web:getInventoryQtyForStyleColorSize></soapenv:Body></soapenv:Envelope>`,
      };
    case "status":
      return {
        url: `${BASE}/promostandards/OrderStatusServiceBinding`,
        action: "getOrderStatusDetails",
        body: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.promostandards.org/WSDL/OrderStatusService/1.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/OrderStatusService/1.0.0/SharedObjects/"><soapenv:Header/><soapenv:Body><ns:GetOrderStatusDetailsRequest><ns:wsVersion>1.0.0</ns:wsVersion><ns:id>${id}</ns:id><ns:password>${pw}</ns:password><ns:queryType>3</ns:queryType><ns:statusTimeStamp>${since}</ns:statusTimeStamp></ns:GetOrderStatusDetailsRequest></soapenv:Body></soapenv:Envelope>`,
      };
    case "shipment":
      return {
        url: `${BASE}/promostandards/OrderShipmentNotificationServiceBinding`,
        action: "getOrderShipmentNotification",
        body: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://www.promostandards.org/WSDL/OrderShipmentNotificationService/1.0.0/" xmlns:shar="http://www.promostandards.org/WSDL/OrderShipmentNotificationService/1.0.0/SharedObjects/"><soapenv:Header/><soapenv:Body><ns:GetOrderShipmentNotificationRequest><shar:wsVersion>1.0.0</shar:wsVersion><shar:id>${id}</shar:id><shar:password>${pw}</shar:password><ns:queryType>3</ns:queryType><ns:shipmentDateTimeStamp>${since}</ns:shipmentDateTimeStamp></ns:GetOrderShipmentNotificationRequest></soapenv:Body></soapenv:Envelope>`,
      };
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const svc = p.get("svc") ?? "inventory";
  const env = envelope(svc, p);
  if (!env) return NextResponse.json({ error: "unknown svc" }, { status: 400 });
  const url = p.get("endpoint") || env.url;
  if (!url.startsWith(BASE)) return NextResponse.json({ error: "endpoint must be on ws.sanmar.com" }, { status: 400 });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=UTF-8", SOAPAction: env.action },
      body: env.body,
      signal: AbortSignal.timeout(20000),
    });
    let text = await res.text();
    for (const secret of [process.env.SANMAR_PASSWORD, process.env.SANMAR_USERNAME]) {
      if (secret) text = text.split(secret).join("***");
    }
    const max = Number(p.get("max")) || 8000;
    return NextResponse.json({ svc, url, httpStatus: res.status, length: text.length, body: text.slice(0, max) });
  } catch (e) {
    return NextResponse.json({ svc, url, error: (e as Error).message }, { status: 502 });
  }
}
