import Header from "@/components/Header";
import QuoteForm from "@/components/QuoteForm";
import HeroSlider from "@/components/HeroSlider";
import ServicePicker from "@/components/ServicePicker";
import Motion from "@/components/Motion";

const CATALOG_A = "https://www.companycasuals.com/jmdm/start.jsp";
const CATALOG_B = "https://www.sportswearcollection.com/categories?site=FCWQLFFVDR";
const DTF_PAGE = "https://buyjmmedia.com/pages/dtf-transfers";
const MAP = "https://goo.gl/maps/paNgFRVNH3AJy69r8";

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const SERVICES = [
  {
    name: "Embroidery",
    text: "Your logo stitched onto polos, button-downs, jackets, beanies and caps. It holds up to daily wear and washing, and it's the look most businesses want on staff uniforms.",
    for: ["Staff Polos", "Jackets", "Caps & Beanies"],
    img: { src: "/img/doorstep-polo.webp", alt: "Technician in an embroidered polo greeting a customer at the door", pos: "60% 40%" },
    caption: "An embroidered polo makes your tech recognizable at the customer's door.",
  },
  {
    name: "DTF Printing",
    text: "Full-color prints with fine detail and gradients, on cotton, polyester and blends. Good for short runs, multi-color logos and event shirts on a deadline.",
    for: ["Event Shirts", "Full-Color Logos", "Small Runs"],
    link: { href: DTF_PAGE, label: "Order Transfers" },
    img: { src: "/img/dtf-press.webp", alt: "Peeling the film off a full-color DTF transfer on a gray t-shirt at the heat press", pos: "50% 50%" },
    caption: "A full-color DTF transfer, fresh off the heat press.",
  },
  {
    name: "Screen Printing",
    text: "The best price per shirt on larger orders with simpler artwork. Bold, durable ink for crew tees, giveaways and team shirts.",
    for: ["Crew Tees", "Giveaways", "Bulk Orders"],
    img: { src: "/img/screen-print.webp", alt: "Squeegee pulling red ink through a screen onto a navy t-shirt on a screen printing press", pos: "40% 50%" },
    caption: "Red ink pulled through the screen, one shirt at a time.",
  },
  {
    name: "UV Printed Patches & Hats",
    text: "Sharp, full-color patches applied to trucker and structured caps. A clean, premium look for logos that are too detailed to stitch.",
    for: ["Patch Hats", "Detailed Logos"],
    img: { src: "/img/uv-patch-hats.webp", alt: "Trucker caps with full-color UV printed hexagon patches, with loose patches on the bench", pos: "55% 50%" },
    caption: "Full-color UV printed patches on trucker caps.",
  },
  {
    name: "UV Printed Tumblers & Cups",
    text: "Your logo printed directly on tumblers and drinkware, for client gifts, sales teams and company events.",
    for: ["Client Gifts", "Events"],
    img: { src: "/img/uv-tumblers.webp", alt: "Navy, white and black tumblers UV printed with a full-color logo, with a UV printer behind them", pos: "35% 50%" },
    caption: "Tumblers UV printed with a full-color logo.",
  },
] as const;

const WHO = [
  {
    img: "/img/roofer-tee.webp",
    alt: "Roofer on a roof wearing a gray branded t-shirt",
    title: "Contractors & trades",
    text: "Hi-vis shirts, tees and caps your crew can wear on the job, so every truck and job site carries your name.",
  },
  {
    img: "/img/showroom-polo.webp",
    alt: "Salesperson in a navy embroidered polo standing in a showroom",
    title: "Storefronts & sales teams",
    text: "Embroidered polos and button-downs that make staff easy to spot and look put together in front of customers.",
  },
  {
    img: "/img/coach-jacket.webp",
    alt: "Coach in an embroidered team jacket on a field",
    title: "Schools, teams & events",
    text: "Jackets, team shirts and event tees, with sizes from youth to adult and a mockup before anything is made.",
  },
];

const WHY = [
  {
    title: "Everything is made in-house",
    text: "Embroidery, DTF, screen printing and UV printing all happen in our Rosenberg shop, so one order can mix methods and stay on one invoice.",
  },
  {
    title: "You see a mockup first",
    text: "We send a mockup of your logo on the actual garment and color before we produce anything.",
  },
  {
    title: "Help with your artwork",
    text: "Blurry logo or just a screenshot? We digitize it for embroidery and vectorize it for print.",
  },
  {
    title: "Brands your team will wear",
    text: "Choose from Gildan, Port Authority, Sport-Tek, Bella+Canvas, Nike, Carhartt, OGIO, Richardson and more.",
  },
];

const STEPS = [
  { title: "Send your logo", text: "Upload it below with what you have in mind, or text it to us." },
  { title: "Get a quote & mockup", text: "We price the order and show your logo on the garments you picked." },
  { title: "Approve it", text: "Ask for changes until it's right. Nothing is made before you approve." },
  { title: "We make it", text: "Your order is decorated in our shop in downtown Rosenberg." },
  { title: "Pick up or ship", text: "Pick up by appointment, or we ship it to you." },
];

export default function Home() {
  return (
    <>
      <Motion />
      <Header />
      <main id="top">
        {/* Hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <h1 className="display hero-h1" aria-label="Branded gear that works as hard as your crew.">
                <span aria-hidden="true"><span className="w" style={{ ["--i" as string]: 0 }}>Branded</span>{" "}<span className="w" style={{ ["--i" as string]: 1 }}>gear</span>{" "}<span className="w" style={{ ["--i" as string]: 2 }}>that</span>{" "}<span className="w" style={{ ["--i" as string]: 3 }}>works</span>{" "}<span className="w" style={{ ["--i" as string]: 4 }}>as</span>{" "}<span className="w" style={{ ["--i" as string]: 5 }}>hard</span>{" "}<span className="w" style={{ ["--i" as string]: 6 }}>as</span>{" "}<span className="w" style={{ ["--i" as string]: 7 }}>your</span>{" "}<span className="w" style={{ ["--i" as string]: 8 }}>crew.</span>{" "}</span>
              </h1>
              <svg className="sew" viewBox="0 0 600 14" preserveAspectRatio="none" aria-hidden="true"><path d="M2 7 C 150 1, 300 13, 598 6" /></svg>
              <p className="lede">
                Embroidered polos, hats and jackets, printed shirts and logo drinkware for contractors, local businesses,
                schools and teams. Made in-house in Rosenberg, Texas.
              </p>
              <div className="hero-cta">
                <a className="btn btn-red" href="#quote">
                  Get a quote
                </a>
                <a className="btn btn-line" href="#catalogs">
                  Browse the catalogs
                </a>
              </div>
              <ul className="hero-facts">
                <li>
                  <Check /> Mockup before production
                </li>
                <li>
                  <Check /> Logo cleanup included
                </li>
                <li>
                  <Check /> Pickup or shipping
                </li>
              </ul>
            </div>
            <HeroSlider />
          </div>
        </section>

        <div className="marquee" aria-label="Services: Embroidery, DTF Printing, Screen Printing, UV Printed Patches, UV Printed Tumblers and Cups, Digitizing, Vectorizing, Mockups">
          <div className="marquee-track" aria-hidden="true">
            <div><span>Embroidery</span><i aria-hidden="true">✚</i><span>DTF Printing</span><i aria-hidden="true">✚</i><span>Screen Printing</span><i aria-hidden="true">✚</i><span>UV Printed Patches</span><i aria-hidden="true">✚</i><span>UV Printed Tumblers &amp; Cups</span><i aria-hidden="true">✚</i><span>Digitizing</span><i aria-hidden="true">✚</i><span>Vectorizing</span><i aria-hidden="true">✚</i><span>Mockups</span><i aria-hidden="true">✚</i></div>
            <div><span>Embroidery</span><i aria-hidden="true">✚</i><span>DTF Printing</span><i aria-hidden="true">✚</i><span>Screen Printing</span><i aria-hidden="true">✚</i><span>UV Printed Patches</span><i aria-hidden="true">✚</i><span>UV Printed Tumblers &amp; Cups</span><i aria-hidden="true">✚</i><span>Digitizing</span><i aria-hidden="true">✚</i><span>Vectorizing</span><i aria-hidden="true">✚</i><span>Mockups</span><i aria-hidden="true">✚</i></div>
          </div>
        </div>

        {/* Services */}
        <section className="section services" id="services">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2 className="display">How we put your logo on</h2>
              <p className="lede">
                Pick the method that fits the garment, the artwork and the budget. Not sure which one? Tell us what it&apos;s
                for and we&apos;ll recommend one.
              </p>
            </div>
            <ServicePicker services={SERVICES} />
          </div>
        </section>

        {/* Who */}
        <section className="section who" id="who">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2 className="display">Built for businesses that show up in person</h2>
              <p className="lede">If your people meet customers, work job sites or represent you at events, they should look the part.</p>
            </div>
            <div className="who-grid">
              {WHO.map((w) => (
                <article className="who-item" key={w.title} data-reveal style={{ ["--d" as string]: `${WHO.indexOf(w) * 110}ms` }}>
                  <figure>
                    <img src={w.img} alt={w.alt} width={718} height={724} loading="lazy" />
                  </figure>
                  <h3>{w.title}</h3>
                  <p>{w.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Why */}
        <section className="section why">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2 className="display">Why businesses order from JM</h2>
            </div>
            <div className="why-grid">
              {WHY.map((w) => (
                <div className="why-item" key={w.title} data-reveal style={{ ["--d" as string]: `${WHY.indexOf(w) * 90}ms` }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  <h3>{w.title}</h3>
                  <p>{w.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Process */}
        <section className="section process" id="process">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2 className="display">How an order works</h2>
              <p className="lede">From your logo to finished gear in five steps.</p>
            </div>
            <ol className="steps" data-reveal>
              {STEPS.map((s) => (
                <li className="step" key={s.title} style={{ ["--d" as string]: `${300 + STEPS.indexOf(s) * 260}ms` }}>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Catalogs */}
        <section className="section catalogs" id="catalogs">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2 className="display">Pick your garments</h2>
              <p className="lede">
                Browse thousands of styles in our two catalogs. Note the style numbers and colors you like, then send them with
                your quote request.
              </p>
            </div>
            <div className="cat-grid">
              <article className="cat" data-reveal>
                <figure>
                  <img src="/img/catalog-a.webp" alt="Polos, tees and jackets from catalog A" width={1200} height={800} loading="lazy" />
                </figure>
                <div className="cat-body">
                  <h3>Catalog A</h3>
                  <p>Everyday workwear and uniforms, plus premium brands.</p>
                  <div className="brands">
                    {["Gildan", "Port & Company", "District", "Bella+Canvas", "Sport-Tek", "Port Authority", "Nike", "OGIO", "Carhartt"].map((b) => (
                      <span key={b}>{b}</span>
                    ))}
                  </div>
                  <a className="btn btn-line on-light" href={CATALOG_A} target="_blank" rel="noopener">
                    Open catalog A
                  </a>
                </div>
              </article>
              <article className="cat" data-reveal>
                <figure>
                  <img src="/img/catalog-b.webp" alt="Performance shirts and hats from catalog B" width={1200} height={800} loading="lazy" />
                </figure>
                <div className="cat-body">
                  <h3>Catalog B</h3>
                  <p>Performance wear, team apparel and hats.</p>
                  <div className="brands">
                    {["CORE365", "Augusta", "Adidas", "Under Armour", "Richardson"].map((b) => (
                      <span key={b}>{b}</span>
                    ))}
                  </div>
                  <a className="btn btn-line on-light" href={CATALOG_B} target="_blank" rel="noopener">
                    Open catalog B
                  </a>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Visit */}
        <section className="section visit" id="visit">
          <div className="wrap visit-grid" data-reveal>
            <figure>
              <img src="/img/shop-front.webp" alt="The JM Digital Media shop on 2nd Street in downtown Rosenberg" width={1400} height={933} loading="lazy" />
            </figure>
            <div>
              <h2 className="display">A local shop in downtown Rosenberg</h2>
              <p className="lede" style={{ marginTop: 20 }}>
                JM Digital Media decorates apparel with state-of-the-art embroidery and printing equipment. We work with
                businesses around Rosenberg and the Houston area, and we can ship your order to you.
              </p>
              <dl>
                <div>
                  <dt>Address</dt>
                  <dd>815 2nd St, Rosenberg, TX 77471</dd>
                </div>
                <div>
                  <dt>Pickups and visits</dt>
                  <dd>By appointment. Text us to set a time.</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>
                    Text <a href="sms:+12813441772">281-344-1772</a> or email{" "}
                    <a href="mailto:purchasing@buyjmmedia.com">purchasing@buyjmmedia.com</a>
                  </dd>
                </div>
              </dl>
              <a className="btn btn-line on-light" href={MAP} target="_blank" rel="noopener">
                Get directions
              </a>
            </div>
          </div>
        </section>

        {/* Quote */}
        <section className="section quote" id="quote">
          <div className="wrap quote-grid">
            <div>
              <h2 className="display">Get a quote</h2>
              <p className="lede" style={{ marginTop: 20 }}>
                Tell us what you need and attach your logo if you have it. We&apos;ll reply with pricing and a mockup.
              </p>
              <hr className="stitch" style={{ margin: "34px 0 0", maxWidth: 320 }} />
              <div className="quote-contact">
                <a href="sms:+12813441772">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                  </svg>
                  Text 281-344-1772
                </a>
                <a href="mailto:purchasing@buyjmmedia.com">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 7l9 6 9-6" />
                  </svg>
                  purchasing@buyjmmedia.com
                </a>
              </div>
            </div>
            <QuoteForm />
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <div className="foot-grid">
            <a className="brand" href="#top">
              <img src="/img/jm-logo.png" alt="" width={46} height={46} />
              <span>JM Digital Media</span>
            </a>
            <nav aria-label="Footer">
              <a href="#services">Services</a>
              <a href="#process">How it works</a>
              <a href="#catalogs">Catalogs</a>
              <a href={DTF_PAGE}>DTF transfers</a>
              <a href="#quote">Get a quote</a>
            </nav>
            <div className="social">
              <a href="https://www.facebook.com/buyjmmedia" target="_blank" rel="noopener" aria-label="Facebook">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M14 8.5V6.8c0-.8.5-1 1-1h2.4V2.1L14.2 2C10.9 2 10 4.3 10 6.4v2.1H7.6V12H10v10h4V12h3l.5-3.5H14z" />
                </svg>
              </a>
              <a href="https://www.instagram.com/media.jm" target="_blank" rel="noopener" aria-label="Instagram">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a href="https://www.tiktok.com/@jmdigitalmedia" target="_blank" rel="noopener" aria-label="TikTok">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.1-2.8V9.1a6.3 6.3 0 1 0 5.5 6.3V8.6a7.7 7.7 0 0 0 4.4 1.4V6.6a4.4 4.4 0 0 1-4.4-4.6z" />
                </svg>
              </a>
            </div>
          </div>
          <small>© {new Date().getFullYear()} JM Digital Media, 815 2nd St, Rosenberg, TX 77471</small>
        </div>
      </footer>
    </>
  );
}
